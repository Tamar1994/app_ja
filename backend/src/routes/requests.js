const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const ServiceRequest = require('../models/ServiceRequest');
const Review = require('../models/Review');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const CouponRedemption = require('../models/CouponRedemption');
const ServiceCoverageCity = require('../models/ServiceCoverageCity');
const ClientWalletTransaction = require('../models/ClientWalletTransaction');
const PixRefundRequest = require('../models/PixRefundRequest');
const { dispatchToNextProfessional, clearRequestTimer, sendExpoPush } = require('../utils/requestQueue');
const { ensureServiceChatForRequest, closeServiceChatForRequest } = require('../utils/serviceChat');
const { resolveProfessionalRewardForCompletion } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');
const {
  findCoverageCityId,
  findCancellationConfig,
  computeCancellationFee,
  computeRefundAmounts,
} = require('../services/cancellationService');
const logger = require('../utils/logger');

const router = express.Router();

const resolveActiveProfile = (user) => {
  if (user?.activeProfile === 'client' || user?.activeProfile === 'professional') {
    return user.activeProfile;
  }
  return user?.userType;
};

const isClientProfile = (user) => resolveActiveProfile(user) === 'client';
const isProfessionalProfile = (user) => resolveActiveProfile(user) === 'professional';

// Verifica conflito de agenda: 30min de buffer antes/depois de cada serviço agendado
async function hasScheduleConflict(professionalId, scheduledDate, durationMinutes, excludeRequestId = null) {
  const BUFFER_MS = 30 * 60 * 1000;
  const start = new Date(scheduledDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const windowStart = new Date(start.getTime() - BUFFER_MS);
  const windowEnd = new Date(end.getTime() + BUFFER_MS);

  const filter = {
    professional: professionalId,
    status: { $in: ['accepted', 'preparing', 'on_the_way', 'in_progress', 'scheduled', 'pending_client'] },
    'details.scheduledDate': {
      $gte: new Date(windowStart.getTime() - 12 * 60 * 60000),
      $lte: new Date(windowEnd.getTime() + 12 * 60 * 60000),
    },
  };
  if (excludeRequestId) filter._id = { $ne: excludeRequestId };

  const existing = await ServiceRequest.find(filter)
    .select('details.scheduledDate details.durationMinutes')
    .lean();

  return existing.some((req) => {
    const eStart = new Date(req.details.scheduledDate);
    const eEnd = new Date(eStart.getTime() + (req.details.durationMinutes || 60) * 60000);
    const eWindowStart = new Date(eStart.getTime() - BUFFER_MS);
    const eWindowEnd = new Date(eEnd.getTime() + BUFFER_MS);
    return start < eWindowEnd && end > eWindowStart;
  });
}


const completionPhotosUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads/completion');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const { randomBytes } = require('crypto');
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Apenas imagens'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});


const normalizeBasicText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

const normalizeCompactText = (value = '') => normalizeBasicText(value).replace(/[^a-z0-9]/g, '');

const legacyLowerText = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const BRAZIL_STATES = {
  ac: 'acre',
  al: 'alagoas',
  ap: 'amapa',
  am: 'amazonas',
  ba: 'bahia',
  ce: 'ceara',
  df: 'distrito federal',
  es: 'espirito santo',
  go: 'goias',
  ma: 'maranhao',
  mt: 'mato grosso',
  ms: 'mato grosso do sul',
  mg: 'minas gerais',
  pa: 'para',
  pb: 'paraiba',
  pr: 'parana',
  pe: 'pernambuco',
  pi: 'piaui',
  rj: 'rio de janeiro',
  rn: 'rio grande do norte',
  rs: 'rio grande do sul',
  ro: 'rondonia',
  rr: 'roraima',
  sc: 'santa catarina',
  sp: 'sao paulo',
  se: 'sergipe',
  to: 'tocantins',
};

const BRAZIL_STATE_NAME_TO_UF = Object.entries(BRAZIL_STATES).reduce((acc, [uf, name]) => {
  acc[normalizeCompactText(name)] = uf;
  return acc;
}, {});

const normalizeCityKey = (value = '') => normalizeCompactText(value);

const normalizeCityLegacyKey = (value = '') => normalizeBasicText(value);

const normalizeStateKey = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const basic = normalizeBasicText(raw);
  const compact = normalizeCompactText(raw);
  if (/^[a-z]{2}$/.test(compact) && BRAZIL_STATES[compact]) return compact;
  if (BRAZIL_STATE_NAME_TO_UF[compact]) return BRAZIL_STATE_NAME_TO_UF[compact];
  return basic;
};

const buildStateCandidates = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const set = new Set();
  const canonical = normalizeStateKey(raw);
  const basic = normalizeBasicText(raw);
  const compact = normalizeCompactText(raw);
  const legacy = legacyLowerText(raw);
  if (canonical) set.add(canonical);
  if (basic) set.add(basic);
  if (compact) set.add(compact);
  if (legacy) set.add(legacy);
  return Array.from(set);
};

const hasAnyCommonValue = (arrA = [], arrB = []) => {
  const set = new Set(arrA);
  return arrB.some((value) => set.has(value));
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function isCityCovered(city = '', state = '') {
  const cityCandidates = Array.from(new Set([
    normalizeCityKey(city),
    normalizeCityLegacyKey(city),
    normalizeCompactText(city),
    normalizeBasicText(city),
  ].filter(Boolean)));
  const requestedStateCandidates = buildStateCandidates(state);

  if (!cityCandidates.length) return { covered: false, coverageCity: null };

  const cityMatches = await ServiceCoverageCity.find({
    normalizedCity: { $in: cityCandidates },
    isActive: true,
  }).sort({ order: 1, city: 1, createdAt: 1 });

  if (!cityMatches.length) return { covered: false, coverageCity: null };
  if (!requestedStateCandidates.length) return { covered: true, coverageCity: cityMatches[0] };

  const exactMatch = cityMatches.find((item) => {
    const storedStateCandidates = buildStateCandidates(item.state)
      .concat(buildStateCandidates(item.normalizedState));
    if (!storedStateCandidates.length) return true;
    return hasAnyCommonValue(storedStateCandidates, requestedStateCandidates);
  });

  if (exactMatch) return { covered: true, coverageCity: exactMatch };

  return { covered: false, coverageCity: null, matchedCity: cityMatches[0] };
}

// GET /api/requests/coverage?city=...&state=...
router.get('/coverage', auth, async (req, res) => {
  try {
    const { city = '', state = '' } = req.query;
    const coverage = await isCityCovered(city, state);
    res.json({
      covered: coverage.covered,
      city: String(city || '').trim(),
      state: String(state || '').trim(),
      coverageCity: coverage.coverageCity || coverage.matchedCity || null,
      message: coverage.covered ? 'Cidade atendida' : 'No momento a solicitação não está disponível na sua cidade, mas a Já! vem ampliando sua zona de cobertura e logo estará disponível na sua cidade também.',
    });
  } catch {
    res.status(500).json({ message: 'Erro ao validar cobertura da cidade' });
  }
});

// POST /api/requests/estimate — estimar valor antes de contratar
router.post('/estimate', auth, async (req, res) => {
  const { serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate, city, state } = req.body;
  try {
    const pricing = await calculateCheckoutPricing({
      serviceTypeSlug: serviceTypeSlug || null,
      tierLabel: tierLabel || null,
      selectedUpsells: selectedUpsells || [],
      scheduledDate: scheduledDate || null,
      city: city || null,
      state: state || null,
    });

    res.json({
      serviceTypeSlug,
      tierLabel,
      tier: pricing.tier,
      upsells: pricing.upsells,
      tierPrice: pricing.tierPrice,
      upsellsTotal: pricing.upsellsTotal,
      estimated: pricing.estimated,
      platformFeePercent: pricing.platformFeePercent,
      platformFee: pricing.platformFee,
      dayNightBreakdown: pricing.dayNightBreakdown,
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Erro ao calcular estimativa' });
  }
});

// POST /api/requests — criar solicitação
router.post('/', auth, [
  body('serviceTypeSlug').notEmpty().withMessage('serviceTypeSlug é obrigatório'),
  body('tierLabel').notEmpty().withMessage('Escolha uma faixa de serviço'),
  body('address.street').notEmpty(),
  body('address.city').notEmpty(),
  body('scheduledDate').isISO8601(),
], async (req, res) => {
  if (!isClientProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas clientes podem solicitar serviços' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    serviceTypeSlug,
    tierLabel,
    selectedUpsells = [],
    notes,
    address,
    scheduledDate,
  } = req.body;

  const coverage = await isCityCovered(address?.city, address?.state);
  if (!coverage.covered) {
    return res.status(403).json({
      message: 'No momento a solicitação não está disponível na sua cidade, mas a Já! vem ampliando sua zona de cobertura e logo estará disponível na sua cidade também.',
    });
  }

  let pricing;
  try {
    pricing = await calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate, city: address?.city || null, state: address?.state || null });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    return res.status(500).json({ message: 'Erro ao calcular preço' });
  }

  try {
    const request = await ServiceRequest.create({
      client: req.user._id,
      serviceTypeSlug,
      requiresLocationTracking: pricing.serviceType?.requiresLocationTracking || false,
      requestType: 'immediate',
      status: 'searching',
      details: {
        tierLabel,
        durationMinutes: pricing.tier.durationMinutes,
        upsells: pricing.upsells,
        notes: notes || '',
        scheduledDate,
      },
      address,
      pricing: {
        tierPrice:          pricing.tierPrice,
        upsellsTotal:       pricing.upsellsTotal,
        estimated:          pricing.estimated,
        platformFeePercent: pricing.platformFeePercent,
        platformFee:        pricing.platformFee,
      },
    });

    const io = req.app.get('io');
    if (io) {
      dispatchToNextProfessional(request._id, io);
    }

    res.status(201).json({ request });
  } catch (err) {
    console.error('[create request]', err);
    res.status(500).json({ message: 'Erro ao criar solicitação' });
  }
});

// GET /api/requests/scheduled-feed — pedidos agendados disponíveis para o profissional aceitar
router.get('/scheduled-feed', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem acessar o feed de agendamentos' });
  }
  try {
    const requests = await ServiceRequest.find({
      requestType: 'scheduled',
      status: 'pending_professional',
      'payment.status': 'paid',
      client: { $ne: req.user._id },
      rejectedBy: { $ne: req.user._id },
      'details.scheduledDate': { $gt: new Date() },
    })
      .populate('client', 'name avatar')
      .sort({ 'details.scheduledDate': 1 })
      .limit(50);
    res.json({ requests });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar pedidos agendados' });
  }
});

// GET /api/requests/my-schedule — agenda do profissional (confirmados)
router.get('/my-schedule', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem acessar a agenda' });
  }
  try {
    const requests = await ServiceRequest.find({
      professional: req.user._id,
      status: { $in: ['scheduled', 'accepted', 'preparing', 'on_the_way', 'in_progress'] },
    })
      .populate('client', 'name avatar phone')
      .sort({ 'details.scheduledDate': 1 });
    res.json({ requests });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar agenda' });
  }
});

// GET /api/requests — listar solicitações
// Cliente: vê as próprias | Profissional: vê disponíveis na região
router.get('/', auth, async (req, res) => {
  try {
    let requests;
    if (isClientProfile(req.user)) {
      requests = await ServiceRequest.find({ client: req.user._id })
        .populate('professional', 'name avatar phone professional.rating professional.totalReviews location')
        .sort({ createdAt: -1 });
    } else {
      const { scope = 'available' } = req.query;
      if (scope === 'my-services') {
        requests = await ServiceRequest.find({
          professional: req.user._id,
          status: { $in: ['accepted', 'preparing', 'on_the_way', 'in_progress', 'completed'] },
        })
          .populate('client', 'name avatar')
          .sort({ updatedAt: -1, createdAt: -1 });
      } else {
        const professionalCity = String(req.user?.professionalAddress?.city || '').trim();
        const cityWideFilter = {
          cityWideNotifiedAt: { $ne: null },
          ...(professionalCity
            ? { 'address.city': new RegExp(`^${escapeRegex(professionalCity)}$`, 'i') }
            : {}),
        };

        requests = await ServiceRequest.find({
          status: 'searching',
          client: { $ne: req.user._id },
          ...(req.user.serviceTypeSlug ? { serviceTypeSlug: req.user.serviceTypeSlug } : {}),
          rejectedBy: { $ne: req.user._id },
          $or: [
            { currentAssignedTo: req.user._id },
            cityWideFilter,
          ],
        })
          .populate('client', 'name avatar')
          .sort({ createdAt: -1 });
      }
    }
    res.json({ requests });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar solicitações' });
  }
});

// GET /api/requests/:id — detalhe de uma solicitação
router.get('/:id', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findById(req.params.id)
      .populate('client', 'name avatar phone')
      .populate('professional', 'name avatar phone professional location');
    if (!request) return res.status(404).json({ message: 'Solicitação não encontrada' });
    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar solicitação' });
  }
});

// PATCH /api/requests/:id/professional-preparing — profissional se preparando
router.patch('/:id/professional-preparing', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem alterar este status' });
  }

  try {
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        professional: req.user._id,
        status: 'accepted',
        clientConfirmedAt: { $ne: null },
      },
      {
        status: 'preparing',
        professionalPreparingAt: new Date(),
      },
      { new: true }
    );

    if (!request) return res.status(400).json({ message: 'Serviço não elegível para preparação' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('request_status_updated', { request });
    }

    // Push para o cliente: profissional está se preparando
    User.findById(request.client).select('pushToken name').then((client) => {
      if (client?.pushToken) {
        sendExpoPush(client.pushToken, '🔧 Profissional se preparando', 'Seu profissional está se preparando para o atendimento.', { requestId: String(request._id), screen: 'Tracking' });
      }
    }).catch(() => {});

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar status para preparação' });
  }
});

// PATCH /api/requests/:id/professional-on-the-way — profissional saiu para atendimento
router.patch('/:id/professional-on-the-way', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem alterar este status' });
  }

  try {
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        professional: req.user._id,
        status: { $in: ['accepted', 'preparing'] },
        clientConfirmedAt: { $ne: null },
      },
      {
        status: 'on_the_way',
        professionalOnTheWayAt: new Date(),
      },
      { new: true }
    );

    if (!request) return res.status(400).json({ message: 'Serviço não elegível para status a caminho' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('request_status_updated', { request });
    }

    // Push para o cliente: profissional a caminho
    User.findById(request.client).select('pushToken').then((client) => {
      if (client?.pushToken) {
        sendExpoPush(client.pushToken, '🚗 Profissional a caminho!', 'Seu profissional saiu e está se deslocando até você.', { requestId: String(request._id), screen: 'Tracking' });
      }
    }).catch(() => {});

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar status para a caminho' });
  }
});

// PATCH /api/requests/:id/professional-location — atualiza localização em tempo real durante deslocamento
router.patch('/:id/professional-location', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem atualizar localização' });
  }

  const longitude = Number(req.body.longitude);
  const latitude = Number(req.body.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return res.status(400).json({ message: 'Coordenadas inválidas' });
  }

  try {
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        professional: req.user._id,
        status: { $in: ['on_the_way', 'preparing', 'accepted'] },
      },
      {
        professionalLiveLocation: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        professionalLiveLocationUpdatedAt: new Date(),
      },
      { new: true }
    );

    if (!request) return res.status(400).json({ message: 'Serviço não elegível para rastreamento' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('professional_location_update', {
        requestId: request._id,
        longitude,
        latitude,
        updatedAt: request.professionalLiveLocationUpdatedAt,
      });
      io.to(`user_${request.client}`).emit('request_status_updated', { request });
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar localização do profissional' });
  }
});

// PATCH /api/requests/:id/accept — profissional aceita (pedido imediato)
router.patch('/:id/accept', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem aceitar' });
  }

  try {
    // Verificar conflito de agenda antes de aceitar
    const pending = await ServiceRequest.findOne({ _id: req.params.id, status: 'searching' })
      .select('client serviceTypeSlug currentAssignedTo cityWideNotifiedAt details.scheduledDate details.durationMinutes')
      .lean();
    if (!pending) return res.status(400).json({ message: 'Solicitação não disponível' });

    if (pending.client?.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: 'Você não pode aceitar uma solicitação criada pela sua própria conta.' });
    }

    if (req.user.serviceTypeSlug && pending.serviceTypeSlug && req.user.serviceTypeSlug !== pending.serviceTypeSlug) {
      return res.status(403).json({ message: 'Você não está habilitado para este tipo de serviço.' });
    }

    const isCityWide = Boolean(pending.cityWideNotifiedAt);
    const assignedToCurrentUser = pending.currentAssignedTo?.toString() === req.user._id.toString();
    if (!isCityWide && !assignedToCurrentUser) {
      return res.status(403).json({ message: 'Esta solicitação está atribuída a outro profissional no momento.' });
    }

    const conflict = await hasScheduleConflict(
      req.user._id,
      pending.details.scheduledDate,
      pending.details.durationMinutes,
    );
    if (conflict) {
      return res.status(409).json({ message: 'Você já tem um serviço agendado neste horário (incluindo 30min de deslocamento). Verifique sua agenda.' });
    }

    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        status: 'searching',
        client: { $ne: req.user._id },
        ...(req.user.serviceTypeSlug ? { serviceTypeSlug: req.user.serviceTypeSlug } : {}),
        $or: [
          { currentAssignedTo: req.user._id },
          { cityWideNotifiedAt: { $ne: null } },
        ],
      },
      {
        status: 'accepted',
        professional: req.user._id,
        acceptedAt: new Date(),
        clientConfirmedAt: null,
        $unset: { currentAssignedTo: '', cityWideNotifiedAt: '' },
      },
      { new: true }
    ).populate('client', 'name avatar phone pushToken');

    if (!request) {
      return res.status(400).json({ message: 'Solicitação não disponível' });
    }

    // Limpar timer da fila
    clearRequestTimer(req.params.id);

    // Limpar prioridade de cancelamento (se tinha)
    User.findByIdAndUpdate(req.user._id, { $unset: { cancelPriority: '' } }).catch(() => {});
    const professional = await User.findById(req.user._id).select('name avatar professional phone');

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client._id}`).emit('request_accepted', {
        request,
        professional: {
          _id: professional._id,
          name: professional.name,
          avatar: professional.avatar,
          phone: professional.phone,
          rating: professional.professional?.rating || 0,
          totalReviews: professional.professional?.totalReviews || 0,
        },
      });

      // Garante fechamento do estado de "chamando" no app do profissional.
      io.to(`user_${req.user._id}`).emit('request_taken', {
        requestId: request._id,
        status: request.status,
      });
    }

    // Push para o cliente: profissional encontrado
    if (request.client?.pushToken) {
      sendExpoPush(request.client.pushToken, '✅ Profissional encontrado!', `${professional.name} aceitou seu pedido. Confirme para continuar.`, { requestId: String(request._id), screen: 'ProfessionalFound' });
    }

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao aceitar serviço' });
  }
});

// PATCH /api/requests/:id/schedule-accept — profissional aceita do feed de agendamentos
router.patch('/:id/schedule-accept', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem aceitar agendamentos' });
  }

  try {
    const pending = await ServiceRequest.findOne({
      _id: req.params.id,
      requestType: 'scheduled',
      status: 'pending_professional',
    }).select('client details.scheduledDate details.durationMinutes').lean();

    if (!pending) return res.status(400).json({ message: 'Agendamento não disponível' });

    if (pending.client?.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: 'Você não pode aceitar um agendamento criado pela sua própria conta.' });
    }

    const conflict = await hasScheduleConflict(
      req.user._id,
      pending.details.scheduledDate,
      pending.details.durationMinutes,
    );
    if (conflict) {
      return res.status(409).json({
        message: 'Você já tem um serviço neste horário (com 30min de deslocamento). Verifique sua agenda antes de aceitar.',
      });
    }

    const request = await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, requestType: 'scheduled', status: 'pending_professional', client: { $ne: req.user._id } },
      {
        status: 'pending_client',
        professional: req.user._id,
        acceptedAt: new Date(),
      },
      { new: true }
    ).populate('client', 'name avatar phone pushToken');

    if (!request) return res.status(400).json({ message: 'Agendamento não disponível' });

    // Limpar prioridade de cancelamento (se tinha)
    User.findByIdAndUpdate(req.user._id, { $unset: { cancelPriority: '' } }).catch(() => {});

    const professional = await User.findById(req.user._id).select('name avatar professional phone');
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client._id}`).emit('schedule_professional_accepted', {
        request,
        professional: {
          _id: professional._id,
          name: professional.name,
          avatar: professional.avatar,
          phone: professional.phone,
          rating: professional.professional?.rating || 0,
          totalReviews: professional.professional?.totalReviews || 0,
        },
      });
    }

    if (request.client?.pushToken) {
      sendExpoPush(
        request.client.pushToken,
        '✅ Profissional disponível para seu agendamento!',
        `${professional.name} aceitou seu agendamento. Confirme para garantir a data.`,
        { requestId: String(request._id), screen: 'ScheduledPending' },
      );
    }

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao aceitar agendamento' });
  }
});

// PATCH /api/requests/:id/schedule-reject — profissional recusa do feed de agendamentos
router.patch('/:id/schedule-reject', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem recusar agendamentos' });
  }
  try {
    const existing = await ServiceRequest.findOne({
      _id: req.params.id,
      status: { $in: ['pending_professional', 'pending_client'] },
    }).select('client status').lean();

    await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['pending_professional', 'pending_client'] } },
      { $addToSet: { rejectedBy: req.user._id }, $unset: { professional: '', acceptedAt: '' }, status: 'pending_professional' },
    );

    // Se estava em pending_client, notificar o cliente que o profissional desistiu
    if (existing?.status === 'pending_client' && existing?.client) {
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${existing.client}`).emit('schedule_professional_withdrew', {
          requestId: req.params.id,
          message: 'O profissional não poderá mais atender este agendamento. Aguardando outro profissional.',
        });
      }
    }

    res.json({ message: 'Agendamento recusado' });
  } catch {
    res.status(500).json({ message: 'Erro ao recusar agendamento' });
  }
});

// PATCH /api/requests/:id/schedule-client-confirm — cliente confirma profissional do agendamento
router.patch('/:id/schedule-client-confirm', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem confirmar' });
  }
  try {
    const request = await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, client: req.user._id, status: 'pending_client' },
      { status: 'scheduled', clientConfirmedAt: new Date() },
      { new: true }
    ).populate('professional', 'name pushToken');

    if (!request) return res.status(404).json({ message: 'Agendamento não encontrado' });

    const io = req.app.get('io');
    if (io && request.professional) {
      io.to(`user_${request.professional._id}`).emit('schedule_client_confirmed', {
        requestId: request._id,
        message: 'O cliente confirmou o agendamento. Está na sua agenda!',
      });
    }

    if (request.professional?.pushToken) {
      sendExpoPush(
        request.professional.pushToken,
        '📅 Agendamento confirmado!',
        `O cliente confirmou. O serviço está na sua agenda.`,
        { requestId: String(request._id), screen: 'Schedule' },
      );
    }

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao confirmar agendamento' });
  }
});

// PATCH /api/requests/:id/schedule-client-reject — cliente recusa profissional do agendamento
router.patch('/:id/schedule-client-reject', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem recusar' });
  }
  try {
    const existing = await ServiceRequest.findOne({
      _id: req.params.id,
      client: req.user._id,
      status: 'pending_client',
    });
    if (!existing) return res.status(404).json({ message: 'Agendamento não encontrado' });

    const rejectedProfId = existing.professional;
    await ServiceRequest.findByIdAndUpdate(req.params.id, {
      status: 'pending_professional',
      $addToSet: { rejectedBy: rejectedProfId },
      $unset: { professional: '', acceptedAt: '', clientConfirmedAt: '' },
    });

    const io = req.app.get('io');
    if (io && rejectedProfId) {
      io.to(`user_${rejectedProfId}`).emit('schedule_client_rejected', {
        requestId: req.params.id,
        message: 'O cliente optou por outro profissional para este agendamento.',
      });
    }

    res.json({ message: 'Buscando outro profissional para o agendamento' });
  } catch {
    res.status(500).json({ message: 'Erro ao recusar profissional do agendamento' });
  }
});

// PATCH /api/requests/:id/reject — profissional recusa
router.patch('/:id/reject', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem recusar' });
  }

  try {
    await ServiceRequest.findByIdAndUpdate(req.params.id, {
      $addToSet: { rejectedBy: req.user._id },
      $unset: { currentAssignedTo: '' },
    });

    // Passar para o próximo profissional da fila
    const io = req.app.get('io');
    if (io) {
      dispatchToNextProfessional(req.params.id, io);
    }

    res.json({ message: 'Solicitação recusada' });
  } catch {
    res.status(500).json({ message: 'Erro ao recusar serviço' });
  }
});

// PATCH /api/requests/:id/client-reject — cliente recusa o profissional e busca outro
router.patch('/:id/client-reject', auth, async (req, res) => {
  if (!isClientProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas clientes podem recusar' });
  }

  try {
    // Pegar ANTES de atualizar para ter o ID do profissional que foi rejeitado
    const existing = await ServiceRequest.findOne({
      _id: req.params.id,
      client: req.user._id,
      status: 'accepted',
    });
    if (!existing) return res.status(404).json({ message: 'Solicitação não encontrada' });

    const rejectedProfessionalId = existing.professional;

    await ServiceRequest.findByIdAndUpdate(req.params.id, {
      status: 'searching',
      $addToSet: { rejectedBy: rejectedProfessionalId },
      $unset: { professional: '', acceptedAt: '', clientConfirmedAt: '' },
    });

    await closeServiceChatForRequest(req.params.id, 'Cliente optou por outro profissional');

    const io = req.app.get('io');
    if (io) {
      // Notificar o profissional que foi rejeitado pelo cliente
      if (rejectedProfessionalId) {
        io.to(`user_${rejectedProfessionalId}`).emit('client_rejected_professional', {
          requestId: req.params.id,
          message: 'O cliente optou por buscar outro profissional.',
        });
      }
      // Despachar para próximo profissional
      dispatchToNextProfessional(req.params.id, io);
    }

    res.json({ message: 'Procurando outro profissional' });
  } catch {
    res.status(500).json({ message: 'Erro ao recusar profissional' });
  }
});

// PATCH /api/requests/:id/client-confirm — cliente confirma o profissional aceito
router.patch('/:id/client-confirm', auth, async (req, res) => {
  if (!isClientProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas clientes podem confirmar' });
  }

  try {
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        client: req.user._id,
        status: 'accepted',
      },
      {
        clientConfirmedAt: new Date(),
      },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: 'Solicitação não encontrada' });

    await ensureServiceChatForRequest(request);

    const io = req.app.get('io');
    if (io && request.professional) {
      io.to(`user_${request.professional}`).emit('client_confirmed', {
        requestId: request._id,
      });
    }

    res.json({ ok: true, request });
  } catch {
    res.status(500).json({ message: 'Erro ao confirmar profissional' });
  }
});

// PATCH /api/requests/:id/start — profissional inicia o serviço
router.patch('/:id/start', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        professional: req.user._id,
        status: { $in: ['accepted', 'preparing', 'on_the_way'] },
        clientConfirmedAt: { $ne: null },
      },
      { status: 'in_progress', startedAt: new Date() },
      { new: true }
    );
    if (!request) return res.status(400).json({ message: 'Serviço não encontrado' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('service_started', { requestId: request._id });
    }

    // Push para o cliente: serviço iniciado
    User.findById(request.client).select('pushToken').then((client) => {
      if (client?.pushToken) {
        sendExpoPush(client.pushToken, '⚡ Serviço iniciado!', 'Seu profissional começou o atendimento.', { requestId: String(request._id), screen: 'Tracking' });
      }
    }).catch(() => {});

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao iniciar serviço' });
  }
});

// PATCH /api/requests/:id/complete — profissional conclui o serviço
router.patch('/:id/complete', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, professional: req.user._id, status: 'in_progress' },
      {
        status: 'completed',
        completedAt: new Date(),
        'pricing.final': req.body.final || null,
        'payment.status': 'paid',
        'payment.paidAt': new Date(),
      },
      { new: true }
    );
    if (!request) return res.status(400).json({ message: 'Serviço não encontrado' });

    // Notificar cliente e fechar chat imediatamente após marcar como concluído
    // O processamento financeiro abaixo é feito em background — erros lá não bloqueiam a resposta
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('service_completed', { requestId: request._id });
    }
    closeServiceChatForRequest(request._id, 'Serviço concluído').catch(() => {});

    // Push para o cliente: serviço concluído
    User.findById(request.client).select('pushToken').then((client) => {
      if (client?.pushToken) {
        sendExpoPush(client.pushToken, '🎉 Serviço concluído!', 'Que tal deixar uma avaliação para o profissional?', { requestId: String(request._id), screen: 'Review' });
      }
    }).catch(() => {});

    // Processar pagamento e carteira de forma isolada para não bloquear o response
    let rewardApplied = { couponCode: null, rewardType: null, totalBenefit: 0, bonusAmount: 0, platformFeeDiscountAmount: 0, platformFeePercentApplied: 15 };
    let updatedRequest = request;
    try {
      // Obter platformFeePercent do ServiceType cadastrado (não mais do PricingConfig global)
      let defaultFeePercent = 15;
      if (request.serviceTypeSlug) {
        const ServiceType = require('../models/ServiceType');
        const st = await ServiceType.findOne({ slug: request.serviceTypeSlug }).select('platformFeePercent').lean();
        if (Number.isFinite(Number(st?.platformFeePercent))) {
          defaultFeePercent = Number(st.platformFeePercent);
        }
      }
      const grossAmount = request.pricing.estimated;
      const reward = await resolveProfessionalRewardForCompletion({
        professionalUser: req.user,
        serviceRequest: request,
        grossAmount,
        defaultFeePercent,
      });
      const platformFee = reward.platformFee;
      const netAmount = Number((grossAmount - platformFee + reward.bonusAmount).toFixed(2));

      if (reward.coupon) {
        await CouponRedemption.updateOne(
          {
            paymentIntentId: `service:${request._id}`,
            coupon: reward.coupon._id,
          },
          {
            $setOnInsert: {
              coupon: reward.coupon._id,
              user: req.user._id,
              serviceRequest: request._id,
              paymentIntentId: `service:${request._id}`,
              couponCodeSnapshot: reward.coupon.code,
              discountAmount: reward.totalBenefit,
            },
          },
          { upsert: true }
        );
      }

      updatedRequest = await ServiceRequest.findByIdAndUpdate(request._id, {
        'pricing.professionalBonus': reward.bonusAmount,
        'pricing.platformFeeDiscount': reward.feeDiscountAmount,
        'pricing.professionalRewardCoupon': reward.coupon ? reward.coupon.code : null,
        'pricing.platformFee': platformFee,
      }, { new: true });

      await Transaction.create({
        professional: req.user._id,
        serviceRequest: request._id,
        type: 'earning',
        grossAmount,
        platformFee,
        amount: netAmount,
        description: reward.coupon
          ? `Serviço concluído + incentivo (${reward.coupon.code})`
          : 'Serviço concluído',
      });

      await User.findByIdAndUpdate(req.user._id, {
        $inc: {
          'professional.totalServicesCompleted': 1,
          'wallet.balance': netAmount,
          'wallet.totalEarned': netAmount,
        },
      });

      rewardApplied = {
        couponCode: reward.coupon ? reward.coupon.code : null,
        rewardType: reward.rewardType,
        totalBenefit: reward.totalBenefit,
        bonusAmount: reward.bonusAmount,
        platformFeeDiscountAmount: reward.feeDiscountAmount,
        platformFeePercentApplied: reward.feePercentApplied,
      };
    } catch (paymentErr) {
      // Erro no processamento financeiro não impede a conclusão do serviço
      console.error('[complete] Erro no processamento financeiro:', paymentErr);
    }

    res.json({
      request: updatedRequest || request,
      rewardApplied,
    });
  } catch {
    res.status(500).json({ message: 'Erro ao concluir serviço' });
  }
});

// Estorna pagamento de agendamento para a carteira do cliente (legado — mantido para compatibilidade)
// Usado apenas quando o profissional cancela pedidos agendados pré-pagos (sem taxa de cancelamento)
async function refundScheduledPaymentToWallet(preCancel) {
  const refundAmount = Number(preCancel.pricing?.final || preCancel.pricing?.estimated || 0);
  if (refundAmount <= 0) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(preCancel.client).session(session);
      if (!user) return;

      if (!user.clientWallet) user.clientWallet = { balance: 0 };
      user.clientWallet.balance = Number(((user.clientWallet.balance || 0) + refundAmount).toFixed(2));
      await user.save({ session });

      await ClientWalletTransaction.create([{
        user: preCancel.client,
        serviceRequest: preCancel._id,
        type: 'credit_refund',
        source: 'support_refund_wallet',
        amount: refundAmount,
        balanceAfterClientWallet: user.clientWallet.balance,
        balanceAfterProfessionalWallet: Number(user.wallet?.balance || 0),
        metadata: { label: 'Estorno de agendamento cancelado' },
      }], { session });

      await ServiceRequest.findByIdAndUpdate(preCancel._id, { 'payment.status': 'refunded' }).session(session);
    });
  } finally {
    await session.endSession();
  }

  // Notifica cliente sobre o estorno
  User.findById(preCancel.client).select('pushToken').then((u) => {
    if (u?.pushToken) {
      sendExpoPush(
        u.pushToken,
        '💰 Estorno processado',
        `R$ ${refundAmount.toFixed(2)} devolvidos à sua carteira Já!`,
        { screen: 'Wallet' },
      );
    }
  }).catch(() => {});
}

// GET /api/requests/:id/cancel-preview — calcula taxa de cancelamento antes de confirmar
router.get('/:id/cancel-preview', auth, async (req, res) => {
  try {
    const clientProfile = isClientProfile(req.user);
    const cancellableStatuses = clientProfile
      ? ['pending_professional', 'pending_client', 'scheduled', 'searching', 'accepted', 'preparing', 'on_the_way']
      : ['pending_client', 'scheduled', 'accepted', 'preparing', 'on_the_way'];
    const filter = clientProfile
      ? { _id: req.params.id, client: req.user._id, status: { $in: cancellableStatuses } }
      : { _id: req.params.id, professional: req.user._id, status: { $in: cancellableStatuses } };

    const request = await ServiceRequest.findOne(filter).lean();
    if (!request) return res.status(404).json({ message: 'Pedido não encontrado ou não pode ser cancelado' });

    // Busca configuração de taxa para essa cidade + tipo
    const coverageCityId = await findCoverageCityId(request.address?.city, request.address?.state);
    const config = await findCancellationConfig(coverageCityId, request.serviceTypeSlug);
    const feeResult = computeCancellationFee(config, request);
    const amounts   = computeRefundAmounts(feeResult, request);

    const paymentMethod = request.payment?.method || null;
    const externalPaid  = amounts.externalPaid;
    const isCard = paymentMethod && (paymentMethod.startsWith('stripe') || paymentMethod === 'card');
    const isPix  = paymentMethod && (paymentMethod.startsWith('pix') || paymentMethod === 'cora_pix');

    res.json({
      requestId:    request._id,
      requestType:  request.requestType,
      currentPhase: feeResult.phase
        ? {
            label:                  feeResult.phase.label,
            platformFeePercent:     feeResult.platformFeePercent,
            professionalFeePercent: feeResult.professionalFeePercent,
            totalFeePercent:        feeResult.totalFeePercent,
          }
        : null,
      totalPaid:     amounts.totalPaid,
      feeAmount:     amounts.feeAmount,
      refundAmount:  amounts.externalRefundAmount + amounts.walletClientRefundAmount + amounts.walletProfessionalRefundAmount,
      walletPaid:    amounts.walletClientPaid + amounts.walletProfessionalPaid,
      externalPaid,
      refundOptions: {
        wallet: { available: true, label: 'Carteira Já', note: 'Reembolso imediato na sua carteira.' },
        original: {
          available: externalPaid > 0 && !!paymentMethod,
          method: paymentMethod,
          label: isCard ? 'Cartão de crédito' : isPix ? 'PIX' : null,
          note: isCard
            ? 'O estorno é automático via Stripe. Pode levar até 2 faturas para aparecer.'
            : isPix
              ? 'O estorno é feito em até 24 horas via PIX para a chave cadastrada.'
              : null,
        },
      },
    });
  } catch (err) {
    console.error('[cancel-preview]', err);
    res.status(500).json({ message: 'Erro ao calcular pré-visualização de cancelamento' });
  }
});

// PATCH /api/requests/:id/cancel — cliente ou profissional cancela
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const clientProfile = isClientProfile(req.user);
    const filter = clientProfile
      ? { _id: req.params.id, client: req.user._id, status: { $in: ['pending_professional', 'pending_client', 'scheduled', 'searching', 'accepted', 'preparing', 'on_the_way'] } }
      : { _id: req.params.id, professional: req.user._id, status: { $in: ['pending_client', 'scheduled', 'accepted', 'preparing', 'on_the_way'] } };

    // Captura estado original antes de cancelar
    const preCancel = await ServiceRequest.findOne(filter).lean();
    if (!preCancel) return res.status(400).json({ message: 'Não foi possível cancelar' });

    // ── Calcula taxa de cancelamento (apenas para clientes) ──────────────
    let feeResult = { phase: null, platformFeePercent: 0, professionalFeePercent: 0, totalFeePercent: 0, refundPercent: 100 };
    let amounts   = computeRefundAmounts(feeResult, preCancel);
    const refundDestination = clientProfile ? (req.body.refundDestination || 'wallet') : 'wallet';

    if (clientProfile) {
      const coverageCityId = await findCoverageCityId(preCancel.address?.city, preCancel.address?.state);
      const config  = await findCancellationConfig(coverageCityId, preCancel.serviceTypeSlug);
      feeResult     = computeCancellationFee(config, preCancel);
      amounts       = computeRefundAmounts(feeResult, preCancel);
    }

    // ── Marca como cancelado ──────────────────────────────────────────────
    const cancellationUpdate = {
      status:      'cancelled',
      cancelledAt:  new Date(),
      cancelReason: req.body.reason || '',
      'cancellation.phaseName':              feeResult.phase?.label || null,
      'cancellation.totalFeePercent':        feeResult.totalFeePercent,
      'cancellation.platformFeePercent':     feeResult.platformFeePercent,
      'cancellation.professionalFeePercent': feeResult.professionalFeePercent,
      'cancellation.feeAmount':              amounts.feeAmount,
      'cancellation.refundAmount':           amounts.externalRefundAmount + amounts.walletClientRefundAmount + amounts.walletProfessionalRefundAmount,
      'cancellation.refundDestination':      refundDestination,
      'payment.status':                      amounts.totalPaid > 0 ? 'refunded' : preCancel.payment?.status,
    };

    const request = await ServiceRequest.findByIdAndUpdate(preCancel._id, cancellationUpdate, { new: true });
    if (!request) return res.status(400).json({ message: 'Não foi possível cancelar' });

    clearRequestTimer(req.params.id);
    await closeServiceChatForRequest(req.params.id, req.body.reason || 'Serviço cancelado');

    // ── Push para o outro lado ────────────────────────────────────────────
    if (clientProfile && preCancel.professional) {
      User.findById(preCancel.professional).select('pushToken').then((pro) => {
        if (pro?.pushToken) sendExpoPush(pro.pushToken, '❌ Pedido cancelado', 'O cliente cancelou a solicitação.', { requestId: String(request._id) });
      }).catch(() => {});
    } else if (!clientProfile) {
      User.findById(preCancel.client).select('pushToken').then((cli) => {
        if (cli?.pushToken) sendExpoPush(cli.pushToken, '❌ Pedido cancelado', 'O profissional cancelou o atendimento. Buscando outro profissional.', { requestId: String(request._id) });
      }).catch(() => {});
    }

    // ── Processa estorno (apenas quando há valor a devolver) ──────────────
    if (amounts.totalPaid > 0) {
      logger.info('[cancel] disparando processCancellationRefund', {
        requestId: preCancel._id,
        totalPaid: amounts.totalPaid,
        feeAmount: amounts.feeAmount,
        externalRefund: amounts.externalRefundAmount,
        walletRefund: amounts.walletClientRefundAmount,
        destination: clientProfile ? refundDestination : 'wallet',
      });
      processCancellationRefund({
        preCancel,
        request,
        feeResult,
        amounts,
        refundDestination: clientProfile ? refundDestination : 'wallet',
      }).catch((err) => logger.error('[cancel] erro em processCancellationRefund', { requestId: preCancel._id, err: err.message, stack: err.stack }));
    } else if (
      !clientProfile &&
      preCancel.requestType === 'scheduled' &&
      preCancel.payment?.status === 'paid' &&
      ['pending_professional', 'pending_client', 'scheduled'].includes(preCancel.status)
    ) {
      // Profissional cancelando agendamento pago: reembolso integral para wallet
      refundScheduledPaymentToWallet(preCancel).catch((err) => logger.error('[cancel] erro em refundScheduledPaymentToWallet', { requestId: preCancel._id, err: err.message }));
    }

    res.json({ request, feeApplied: amounts.feeAmount > 0, refundAmount: amounts.externalRefundAmount + amounts.walletClientRefundAmount + amounts.walletProfessionalRefundAmount });

    // ── Prioridade de despacho para o profissional cancelado enquanto a caminho ──
    // Quando o CLIENTE cancela e o profissional estava a caminho (ou já aceito/preparando),
    // o profissional recebe prioridade de 30 min para novos pedidos na sua região.
    // (fire-and-forget — nenhum throw síncrono possível, seguro após res.json)
    if (clientProfile && preCancel.professional &&
        ['on_the_way', 'accepted', 'preparing'].includes(preCancel.status)) {
      const PRIORITY_MS = 30 * 60 * 1000; // 30 minutos
      // Atualiza e busca pushToken na mesma operação (sem round-trip extra)
      User.findByIdAndUpdate(
        preCancel.professional,
        { cancelPriority: { active: true, expiresAt: new Date(Date.now() + PRIORITY_MS) } },
        { new: true, select: 'pushToken' },
      ).then((pro) => {
        if (pro?.pushToken) {
          sendExpoPush(
            pro.pushToken,
            '📍 Prioridade ativada!',
            'Você tem prioridade por 30 min para novos pedidos na sua região.',
            { type: 'cancel_priority' },
          );
        }
      }).catch(() => {});
    }
  } catch (err) {
    logger.error('[cancel] erro na rota', { requestId: req.params.id, uid: req.user?._id, err: err.message, stack: err.stack });
    res.status(500).json({ message: 'Erro ao cancelar' });
  }
});

/**
 * Processa o estorno após o cancelamento:
 *  - Devolve parcela de wallet ao clientWallet (imediato)
 *  - Devolve parcela de wallet profissional ao wallet (imediato)
 *  - Crédita taxa do profissional no wallet profissional (se aplicável)
 *  - Para 'wallet': restante vai para clientWallet
 *  - Para 'original' + cartão: solicita refund via Stripe
 *  - Para 'original' + PIX: cria PixRefundRequest na fila do admin
 */
async function processCancellationRefund({ preCancel, request, feeResult, amounts, refundDestination }) {
  logger.info('[refund] iniciando processCancellationRefund', {
    requestId: preCancel._id,
    client: preCancel.client,
    destination: refundDestination,
    totalPaid: amounts.totalPaid,
    feeAmount: amounts.feeAmount,
    walletClientRefund: amounts.walletClientRefundAmount,
    walletProfessionalRefund: amounts.walletProfessionalRefundAmount,
    externalRefund: amounts.externalRefundAmount,
  });

  const session = await mongoose.startSession();
  let pixRefundDoc = null;

  try {
    await session.withTransaction(async () => {
      const clientUser = await User.findById(preCancel.client).session(session);
      if (!clientUser) {
        logger.warn('[refund] clientUser não encontrado', { requestId: preCancel._id, client: preCancel.client });
        return;
      }

      if (!clientUser.clientWallet) clientUser.clientWallet = { balance: 0, totalRefunded: 0 };

      // 1. Devolve parcela de walletClient → clientWallet
      if (amounts.walletClientRefundAmount > 0) {
        clientUser.clientWallet.balance = Number(
          ((clientUser.clientWallet.balance || 0) + amounts.walletClientRefundAmount).toFixed(2),
        );
        clientUser.clientWallet.totalRefunded = Number(
          ((clientUser.clientWallet.totalRefunded || 0) + amounts.walletClientRefundAmount).toFixed(2),
        );
        await ClientWalletTransaction.create([{
          user: preCancel.client,
          serviceRequest: preCancel._id,
          type: 'credit_refund',
          source: 'client_wallet',
          amount: amounts.walletClientRefundAmount,
          balanceAfterClientWallet: clientUser.clientWallet.balance,
          metadata: { label: 'Estorno de cancelamento (carteira cliente)' },
        }], { session });
      }

      // 2. Devolve parcela de walletProfessional → wallet do profissional "cliente"
      if (amounts.walletProfessionalRefundAmount > 0 && preCancel.client) {
        clientUser.wallet = clientUser.wallet || { balance: 0, totalEarned: 0 };
        clientUser.wallet.balance = Number(
          ((clientUser.wallet.balance || 0) + amounts.walletProfessionalRefundAmount).toFixed(2),
        );
        await ClientWalletTransaction.create([{
          user: preCancel.client,
          serviceRequest: preCancel._id,
          type: 'credit_refund',
          source: 'professional_wallet',
          amount: amounts.walletProfessionalRefundAmount,
          balanceAfterProfessionalWallet: clientUser.wallet.balance,
          metadata: { label: 'Estorno de cancelamento (carteira profissional)' },
        }], { session });
      }

      // 3. Crédita taxa de cancelamento ao profissional (se houver profissional aceito)
      if (amounts.professionalEarning > 0 && preCancel.professional) {
        const professional = await User.findById(preCancel.professional).session(session);
        if (professional) {
          professional.wallet = professional.wallet || { balance: 0, totalEarned: 0 };
          professional.wallet.balance    = Number(((professional.wallet.balance    || 0) + amounts.professionalEarning).toFixed(2));
          professional.wallet.totalEarned= Number(((professional.wallet.totalEarned|| 0) + amounts.professionalEarning).toFixed(2));
          await professional.save({ session });
          await Transaction.create([{
            professional:   preCancel.professional,
            serviceRequest: preCancel._id,
            type:           'earning',
            grossAmount:    amounts.professionalEarning,
            platformFee:    0,
            amount:         amounts.professionalEarning,
            description:    `Taxa de cancelamento — ${feeResult.phase?.label || ''}`,
          }], { session });
        }
      }

      // 4. Estorno da parcela external
      if (amounts.externalRefundAmount > 0) {
        if (refundDestination === 'wallet') {
          // Tudo vai para carteira do cliente → imediato
          clientUser.clientWallet.balance = Number(
            ((clientUser.clientWallet.balance || 0) + amounts.externalRefundAmount).toFixed(2),
          );
          clientUser.clientWallet.totalRefunded = Number(
            ((clientUser.clientWallet.totalRefunded || 0) + amounts.externalRefundAmount).toFixed(2),
          );
          await ClientWalletTransaction.create([{
            user: preCancel.client,
            serviceRequest: preCancel._id,
            type: 'credit_refund',
            source: 'client_wallet',
            amount: amounts.externalRefundAmount,
            balanceAfterClientWallet: clientUser.clientWallet.balance,
            metadata: { label: 'Estorno de cancelamento (pagamento externo → carteira)' },
          }], { session });
        } else {
          // 'original' → Stripe ou PIX — tratado fora da transação (abaixo)
          const paymentMethod = preCancel.payment?.method || '';
          const isPix = paymentMethod.startsWith('pix') || paymentMethod === 'cora_pix';

          if (isPix) {
            // Cria entrada na fila de estorno PIX
            const pixKeyUser = await User.findById(preCancel.client).select('cpf').lean();
            const [prd] = await PixRefundRequest.create([{
              serviceRequest: preCancel._id,
              client:         preCancel.client,
              amount:         amounts.externalRefundAmount,
              pixKey:         pixKeyUser?.cpf || null,
              pixKeyType:     pixKeyUser?.cpf ? 'cpf' : null,
              pixChargeId:    preCancel.payment?.transactionId || null,
              cancelFeeSnapshot: {
                phaseName:              feeResult.phase?.label || '',
                totalFeePercent:        feeResult.totalFeePercent,
                platformFeePercent:     feeResult.platformFeePercent,
                professionalFeePercent: feeResult.professionalFeePercent,
                feeAmount:              amounts.feeAmount,
                totalPaid:              amounts.totalPaid,
              },
            }], { session });
            pixRefundDoc = prd;
          }
          // Stripe: processado fora da transação para evitar rollback em caso de erro de rede
        }
      }

      await clientUser.save({ session });
      logger.info('[refund] usuário salvo, transação MongoDB concluída', {
        requestId: preCancel._id,
        newClientWalletBalance: clientUser.clientWallet?.balance,
        pixRefundCreated: !!pixRefundDoc,
      });

      // Atualiza request com id do PixRefundRequest (se criado)
      if (pixRefundDoc) {
        await ServiceRequest.findByIdAndUpdate(preCancel._id, {
          'cancellation.pixRefundRequestId': pixRefundDoc._id,
        }).session(session);
      }
    });
  } finally {
    await session.endSession();
    logger.debug('[refund] sessão MongoDB encerrada', { requestId: preCancel._id });
  }

  // Stripe refund (fora da transação Mongo para não misturar erros de rede)
  if (
    refundDestination === 'original' &&
    amounts.externalRefundAmount > 0 &&
    !pixRefundDoc
  ) {
    const paymentMethod   = preCancel.payment?.method || '';
    const isStripe = paymentMethod.startsWith('stripe') || paymentMethod === 'card';
    if (isStripe && preCancel.payment?.transactionId) {
      try {
        const getStripe = require('../routes/payments').getStripe;
        const stripe    = await getStripe();
        const stripeRefund = await stripe.refunds.create({
          payment_intent: preCancel.payment.transactionId,
          amount: Math.round(amounts.externalRefundAmount * 100), // centavos
          reason: 'requested_by_customer',
        });
        await ServiceRequest.findByIdAndUpdate(preCancel._id, {
          'cancellation.stripeRefundId': stripeRefund.id,
        });
      } catch (err) {
        logger.error('[refund] erro no estorno Stripe', { requestId: preCancel._id, err: err.message, stack: err.stack });
        // Falha no Stripe → retorna para carteira como fallback
        const clientUser = await User.findById(preCancel.client);
        if (clientUser) {
          if (!clientUser.clientWallet) clientUser.clientWallet = { balance: 0, totalRefunded: 0 };
          clientUser.clientWallet.balance = Number(
            ((clientUser.clientWallet.balance || 0) + amounts.externalRefundAmount).toFixed(2),
          );
          clientUser.clientWallet.totalRefunded = Number(
            ((clientUser.clientWallet.totalRefunded || 0) + amounts.externalRefundAmount).toFixed(2),
          );
          await clientUser.save();
          await ClientWalletTransaction.create({
            user: preCancel.client,
            serviceRequest: preCancel._id,
            type: 'credit_refund',
            source: 'client_wallet',
            amount: amounts.externalRefundAmount,
            balanceAfterClientWallet: clientUser.clientWallet.balance,
            metadata: { label: 'Estorno de cancelamento (fallback carteira — falha Stripe)' },
          });
        }
      }
    }
  }

  // Push de notificação para o cliente
  User.findById(preCancel.client).select('pushToken').then((u) => {
    if (!u?.pushToken) return;
    const totalRefund = amounts.externalRefundAmount + amounts.walletClientRefundAmount + amounts.walletProfessionalRefundAmount;
    if (totalRefund <= 0) return;
    const dest = refundDestination === 'wallet' ? 'sua carteira Já' : (
      (preCancel.payment?.method || '').includes('pix') ? 'via PIX (até 24h)' : 'seu cartão (até 2 faturas)'
    );
    sendExpoPush(
      u.pushToken,
      '💰 Reembolso processado',
      `R$ ${totalRefund.toFixed(2)} serão devolvidos para ${dest}.`,
      { screen: 'ClientWallet' },
    );
  }).catch(() => {});
  logger.info('[refund] processCancellationRefund concluído', { requestId: preCancel._id });
}


// POST /api/requests/:id/review — avaliação mútua após conclusão
// Cliente avalia profissional | Profissional avalia cliente
router.post('/:id/review', auth, async (req, res) => {
  const { rating, comment, npsScore } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Avaliação deve ser entre 1 e 5' });
  }

  const parsedNps = (typeof npsScore === 'number' && Number.isInteger(npsScore) && npsScore >= 0 && npsScore <= 10)
    ? npsScore
    : null;

  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request || request.status !== 'completed') {
      return res.status(400).json({ message: 'Serviço não concluído' });
    }

    const isClient = req.user._id.toString() === request.client.toString();
    const isProfessional = request.professional && req.user._id.toString() === request.professional.toString();

    if (!isClient && !isProfessional) {
      return res.status(403).json({ message: 'Você não faz parte deste serviço' });
    }

    const reviewerRole = isClient ? 'client' : 'professional';
    const reviewed = isClient ? request.professional : request.client;

    const existing = await Review.findOne({ serviceRequest: request._id, reviewer: req.user._id });
    if (existing) return res.status(400).json({ message: 'Você já avaliou este serviço' });

    const review = await Review.create({
      serviceRequest: request._id,
      reviewer: req.user._id,
      reviewed,
      reviewerRole,
      rating,
      comment,
      npsScore: parsedNps,
    });

    res.status(201).json({ review });
  } catch {
    res.status(500).json({ message: 'Erro ao avaliar' });
  }
});

// POST /api/requests/:id/completion-photos — profissional envia fotos de comprovação
router.post('/:id/completion-photos', auth, completionPhotosUpload.array('photos', 10), async (req, res) => {
  try {
    const request = await ServiceRequest.findOne({ _id: req.params.id, professional: req.user._id });
    if (!request) return res.status(404).json({ message: 'Serviço não encontrado' });
    if (!['in_progress', 'completed'].includes(request.status)) {
      return res.status(400).json({ message: 'Upload só permitido ao concluir o serviço' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Nenhuma foto enviada' });
    }
    const urls = req.files.map(f => `/uploads/completion/${f.filename}`);
    await ServiceRequest.findByIdAndUpdate(req.params.id, {
      $push: { completionPhotos: { $each: urls } },
    });
    res.json({ ok: true, photos: urls });
  } catch (err) {
    console.error('[completion-photos]', err);
    res.status(500).json({ message: 'Erro ao salvar fotos' });
  }
});

module.exports = router;
