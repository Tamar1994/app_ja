/**
 * requestQueue.js — Sistema de despacho inteligente de solicitações
 * Funciona como Uber/iFood: notifica 1 profissional por vez, 2 min de timeout.
 * Se expirar ou recusar → próximo profissional disponível.
 */

const https = require('https');

const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

// Mapa de timers ativos: requestId → timeoutHandle
const activeTimers = new Map();

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

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log(`📲 Push enviado → ${pushToken.slice(-10)} | status ${res.statusCode}`);
    });
  });

  req.on('error', (err) => {
    console.error('Erro ao enviar push:', err.message);
  });

  req.write(payload);
  req.end();
}

/**
 * Encontra o próximo profissional disponível do mais próximo ao mais distante.
 */
async function findNextProfessional(request) {
  const User = require('../models/User');

  const excluded = [
    ...(request.rejectedBy || []).map(id => id.toString()),
    ...(request.currentAssignedTo ? [request.currentAssignedTo.toString()] : []),
  ];

  const [longitude, latitude] = request?.address?.coordinates || [];
  const hasValidCoordinates = Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && !(longitude === 0 && latitude === 0);

  const baseFilter = {
    userType: 'professional',
    'professional.isAvailable': true,
    _id: { $nin: excluded },
  };

  if (hasValidCoordinates) {
    const nearest = await User.find({
      ...baseFilter,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        },
      },
    });
    if (nearest.length) return nearest[0];
  }

  const fallback = await User.find(baseFilter)
    .sort({ 'professional.rating': -1, 'professional.totalReviews': -1 });
  return fallback[0] || null;
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

  const professional = await findNextProfessional(request);

  if (!professional) {
    // Nenhum profissional disponível no momento
    io.to(`user_${request.client._id}`).emit('no_professionals_available', {
      requestId,
      message: 'Nenhum profissional disponível agora. Tente novamente em alguns minutos.',
    });
    return;
  }

  // Marcar quem está sendo notificado
  await ServiceRequest.findByIdAndUpdate(requestId, {
    currentAssignedTo: professional._id,
  });

  const timeoutAt = Date.now() + TIMEOUT_MS;

  // Emitir APENAS para este profissional
  io.to(`user_${professional._id}`).emit('new_request', {
    requestId: request._id,
    client: { name: request.client?.name || 'Cliente' },
    details: request.details,
    address: request.address,
    pricing: request.pricing,
    timeoutAt, // cliente/profissional exibem countdown
  });

  console.log(`📢 Pedido ${requestId} → ${professional.name} (${professional._id}) | timeout: 2min`);

  // Enviar push notification (funciona mesmo com app fechado/tela desligada)
  if (professional.pushToken) {
    const city = request.address?.city || 'sua região';
    const earnings = ((request.pricing?.estimated || 0) * 0.85).toFixed(2).replace('.', ',');
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

      // Avisar profissional que o tempo expirou (fechar modal)
      io.to(`user_${professional._id}`).emit('request_expired', { requestId });

      console.log(`⏰ Timeout: pedido ${requestId}, profissional ${professional.name} → próximo`);

      // Despachar para o próximo
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
    console.log(`🧹 Timer limpo: pedido ${key}`);
  }
}

module.exports = { dispatchToNextProfessional, clearRequestTimer };
