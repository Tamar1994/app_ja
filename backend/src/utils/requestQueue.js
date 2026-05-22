/**
 * requestQueue.js — Sistema de despacho inteligente de solicitações
 * Funciona como Uber/iFood: notifica 1 profissional por vez, 2 min de timeout.
 * Se expirar ou recusar → próximo profissional disponível.
 */

const https = require('https');

const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos
const INITIAL_TARGET_PROS = 3;
const CITY_WIDE_AFTER_REJECTIONS = 3;
const RADIUS_STEPS_METERS = [2000, 5000, 10000, 20000, 35000, 50000];

// Mapa de timers ativos: requestId → timeoutHandle
const activeTimers = new Map();

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBaseProfessionalFilter(request, excluded) {
  const filter = {
    $or: [{ userType: 'professional' }, { 'profileModes.professional': true }],
    activeProfile: 'professional',
    'professional.isAvailable': true,
    _id: { $nin: excluded },
  };

  // Profissional precisa estar habilitado no tipo de serviço solicitado.
  if (request?.serviceTypeSlug) {
    filter.serviceTypeSlug = request.serviceTypeSlug;
  }

  // Pedido especialista: apenas especialistas certificados recebem.
  if (request?.isSpecialist) {
    filter['professional.isSpecialist'] = true;
  }

  return filter;
}

function buildExcludedIds(request) {
  const requesterId = (request?.client?._id || request?.client || '').toString();
  return [
    ...(request.rejectedBy || []).map(id => id.toString()),
    ...(request.currentAssignedTo ? [request.currentAssignedTo.toString()] : []),
    ...(requesterId ? [requesterId] : []),
  ];
}

async function findNearbyPool(request, targetCount) {
  const User = require('../models/User');

  const excluded = buildExcludedIds(request);
  const baseFilter = buildBaseProfessionalFilter(request, excluded);
  const [longitude, latitude] = request?.address?.coordinates || [];
  const hasValidCoordinates = Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && !(longitude === 0 && latitude === 0);

  if (!hasValidCoordinates) {
    const fallback = await User.find(baseFilter)
      .sort({ 'professional.rating': -1, 'professional.totalReviews': -1 })
      .limit(targetCount);
    return fallback;
  }

  const selected = [];
  const selectedIds = new Set();

  for (const radius of RADIUS_STEPS_METERS) {
    const chunk = await User.find({
      ...baseFilter,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: radius,
        },
      },
    }).limit(targetCount);

    for (const professional of chunk) {
      const key = professional._id.toString();
      if (selectedIds.has(key)) continue;
      selected.push(professional);
      selectedIds.add(key);
      if (selected.length >= targetCount) return selected;
    }
  }

  return selected;
}

async function findCityWidePool(request) {
  const User = require('../models/User');

  const excluded = buildExcludedIds(request);
  const baseFilter = buildBaseProfessionalFilter(request, excluded);
  const requestCity = String(request?.address?.city || '').trim();

  if (requestCity) {
    baseFilter['professionalAddress.city'] = new RegExp(`^${escapeRegex(requestCity)}$`, 'i');
  }

  return User.find(baseFilter)
    .sort({ 'professional.rating': -1, 'professional.totalReviews': -1 });
}

/**
 * Envia push notification via Expo Push API (funciona com app em background/fechado)
 */
function sendExpoPush(pushToken, title, body, data = {}) {
  const isExpoToken = String(pushToken || '').startsWith('ExponentPushToken')
    || String(pushToken || '').startsWith('ExpoPushToken');
  if (!isExpoToken) return;

  const payload = JSON.stringify({
    to: pushToken,
    title,
    body,
    data,
    channelId: 'job-alerts',   // canal de alta prioridade configurado no app
    priority: 'high',
    sound: 'default',
    ttl: 120,                  // expira em 2 min (mesmo que o timeout)
    android: {
      channelId: 'job-alerts',
      priority: 'max',
      sticky: false,
    },
  });

  const options = {
    hostname: 'exp.host',
    path: '/--/api/v2/push/send',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const ticket = Array.isArray(json.data) ? json.data[0] : json.data;
          if (ticket?.status === 'error') {
            console.error(`❌ Push FALHOU → ${String(pushToken).slice(-10)} | erro: ${ticket.message} | detalhe: ${JSON.stringify(ticket.details)}`);
          } else {
            // console.log(`📲 Push OK → ${String(pushToken).slice(-10)} | id: ${ticket?.id}`);
          }
          resolve(ticket);
        } catch {
          // console.log(`📲 Push → ${String(pushToken).slice(-10)} | HTTP ${res.statusCode} | body: ${raw}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Erro ao enviar push:', err.message);
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Despacha o pedido para o próximo profissional disponível.
 * Chamado ao criar pedido, ao rejeitar, ao expirar.
 */
async function dispatchToNextProfessional(requestId, io) {
  const ServiceRequest = require('../models/ServiceRequest');

  clearRequestTimer(requestId);

  const request = await ServiceRequest.findById(requestId)
    .populate('client', 'name avatar');

  if (!request || request.status !== 'searching') return;

  const alreadyRejected = Array.isArray(request.rejectedBy) ? request.rejectedBy.length : 0;
  const cityWideMode = alreadyRejected >= CITY_WIDE_AFTER_REJECTIONS;

  if (cityWideMode) {
    if (request.cityWideNotifiedAt) {
      return;
    }

    const cityProfessionals = await findCityWidePool(request);
    if (!cityProfessionals.length) {
      const message = request.isSpecialist
        ? 'Nenhum Profissional Especialista disponível na sua cidade no momento.'
        : 'Nenhum profissional disponível na sua cidade no momento.';
      io.to(`user_${request.client._id}`).emit('no_professionals_available', {
        requestId,
        isSpecialist: !!request.isSpecialist,
        message,
      });
      return;
    }

    const feePercent1 = request.pricing?.platformFeePercent ?? 15;
    const earnings = ((request.pricing?.estimated || 0) * (1 - feePercent1 / 100)).toFixed(2).replace('.', ',');
    const city = request.address?.city || 'sua região';
    const timeoutAt = Date.now() + TIMEOUT_MS;

    await ServiceRequest.findByIdAndUpdate(requestId, {
      cityWideNotifiedAt: new Date(),
      $unset: { currentAssignedTo: '' },
    });

    for (const professional of cityProfessionals) {
      io.to(`user_${professional._id}`).emit('new_request', {
        requestId: request._id,
        isSpecialist: !!request.isSpecialist,
        client: { name: request.client?.name || 'Cliente', avatar: request.client?.avatar || null },
        details: request.details,
        address: request.address,
        pricing: request.pricing,
        timeoutAt,
      });

      if (professional.pushToken) {
        sendExpoPush(
          professional.pushToken,
          '🧹 Nova solicitação de serviço!',
          `Cliente em ${city} • R$ ${earnings} • Responda em 2 min`,
          {
            type: 'new_request',
            requestId: request._id.toString(),
            client: { name: request.client?.name || 'Cliente' },
            details: request.details,
            address: request.address,
            pricing: request.pricing,
            timeoutAt,
          }
        );
      }
    }
    return;
  }

  const pool = await findNearbyPool(request, INITIAL_TARGET_PROS);
  const professional = pool[0] || null;

  if (!professional) {
    const message = request.isSpecialist
      ? 'Nenhum Profissional Especialista disponível agora. Tente novamente em alguns minutos.'
      : 'Nenhum profissional disponível agora. Tente novamente em alguns minutos.';
    io.to(`user_${request.client._id}`).emit('no_professionals_available', {
      requestId,
      isSpecialist: !!request.isSpecialist,
      message,
    });
    return;
  }

  // Marcar quem está sendo notificado
  await ServiceRequest.findByIdAndUpdate(requestId, {
    currentAssignedTo: professional._id,
  });

  const timeoutAt = Date.now() + TIMEOUT_MS;

  io.to(`user_${professional._id}`).emit('new_request', {
    requestId: request._id,
    isSpecialist: !!request.isSpecialist,
    client: { name: request.client?.name || 'Cliente', avatar: request.client?.avatar || null },
    details: request.details,
    address: request.address,
    pricing: request.pricing,
    timeoutAt,
  });

  if (professional.pushToken) {
    const city = request.address?.city || 'sua região';
    const feePercent2 = request.pricing?.platformFeePercent ?? 15;
    const earnings = ((request.pricing?.estimated || 0) * (1 - feePercent2 / 100)).toFixed(2).replace('.', ',');
    sendExpoPush(
      professional.pushToken,
      '🧹 Nova solicitação de serviço!',
      `Cliente em ${city} • R$ ${earnings} • Responda em 2 min`,
      {
        type: 'new_request',
        requestId: request._id.toString(),
        client: { name: request.client?.name || 'Cliente' },
        details: request.details,
        address: request.address,
        pricing: request.pricing,
        timeoutAt,
      }
    );
  }

  // Timer de 2 min — se expirar, passa para o próximo
  const timer = setTimeout(async () => {
    activeTimers.delete(requestId.toString());
    try {
      const current = await ServiceRequest.findById(requestId);
      if (!current || current.status !== 'searching') return;

      await ServiceRequest.findByIdAndUpdate(requestId, {
        $addToSet: { rejectedBy: professional._id },
        $unset: { currentAssignedTo: '' },
      });

      io.to(`user_${professional._id}`).emit('request_expired', { requestId });

      await dispatchToNextProfessional(requestId, io);
    } catch (err) {
      console.error('Erro no timeout do pedido:', err);
    }
  }, TIMEOUT_MS);

  activeTimers.set(requestId.toString(), timer);
}

/**
 * Limpa o timer de um pedido (chamado ao aceitar, cancelar, completar)
 */
function clearRequestTimer(requestId) {
  const key = requestId.toString();
  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
    activeTimers.delete(key);
  }
}

module.exports = { dispatchToNextProfessional, clearRequestTimer, sendExpoPush };
