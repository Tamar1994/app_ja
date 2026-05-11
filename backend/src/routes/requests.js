const express = require('express');
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
const { dispatchToNextProfessional, clearRequestTimer } = require('../utils/requestQueue');
const { ensureServiceChatForRequest, closeServiceChatForRequest } = require('../utils/serviceChat');
const { resolveProfessionalRewardForCompletion } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');

const router = express.Router();

// Multer para fotos de conclusão de serviço
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

const SPECIALIST_PREMIUM_PERCENT = 30; // acrescimo percentual para pedidos especialista

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
  const { hours, hasProducts, serviceTypeSlug, customFormData, isSpecialist } = req.body;
  try {
    const pricing = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });

    const specialistPremium = isSpecialist
      ? Math.round(pricing.estimated * SPECIALIST_PREMIUM_PERCENT) / 100
      : 0;
    const totalEstimated = pricing.estimated + specialistPremium;

    res.json({
      pricePerHour: pricing.pricePerHour,
      hours,
      estimated: totalEstimated,
      specialistPremium,
      isSpecialist: !!isSpecialist,
      platformFee: pricing.platformFee,
      total: totalEstimated,
      serviceTypeSlug: serviceTypeSlug || null,
      usedServiceBasePrice: pricing.usedServiceBasePrice,
      customFormData: pricing.normalizedCustomFormData,
      pricingBreakdown: pricing.pricingBreakdown,
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
  body('hours').isInt({ min: 1, max: 24 }),
  body('address.street').notEmpty(),
  body('address.city').notEmpty(),
  body('scheduledDate').isISO8601(),
], async (req, res) => {
  if (req.user.userType !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem solicitar serviços' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    hours,
    rooms,
    bathrooms,
    hasProducts,
    notes,
    address,
    scheduledDate,
    serviceTypeSlug,
    customFormData,
    isSpecialist,
  } = req.body;

  const coverage = await isCityCovered(address?.city, address?.state);
  if (!coverage.covered) {
    return res.status(403).json({
      message: 'No momento a solicitação não está disponível na sua cidade, mas a Já! vem ampliando sua zona de cobertura e logo estará disponível na sua cidade também.',
    });
  }

  let pricePerHour, estimated, platformFee, specialistPremium = 0;
  let normalizedCustomFormData = {};
  let customFormSummary = [];
  try {
    const pricing = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });
    pricePerHour = pricing.pricePerHour;
    estimated = pricing.estimated;
    platformFee = pricing.platformFee;
    normalizedCustomFormData = pricing.normalizedCustomFormData;
    customFormSummary = pricing.customFormSummary;
    if (isSpecialist) {
      specialistPremium = Math.round(estimated * SPECIALIST_PREMIUM_PERCENT) / 100;
      estimated = estimated + specialistPremium;
    }
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    pricePerHour = 35;
    if (!hasProducts) pricePerHour += 5;
    estimated = pricePerHour * hours;
    if (isSpecialist) {
      specialistPremium = Math.round(estimated * SPECIALIST_PREMIUM_PERCENT) / 100;
      estimated = estimated + specialistPremium;
    }
    platformFee = (estimated * 15) / 100;
    normalizedCustomFormData = customFormData && typeof customFormData === 'object' ? customFormData : {};
    customFormSummary = [];
  }

  try {
    // Verificar se o tipo de serviço exige rastreamento de localização
    let requiresLocationTracking = false;
    if (serviceTypeSlug) {
      const ServiceType = require('../models/ServiceType');
      const st = await ServiceType.findOne({ slug: serviceTypeSlug }).select('requiresLocationTracking');
      requiresLocationTracking = st?.requiresLocationTracking || false;
    }

    const request = await ServiceRequest.create({
      client: req.user._id,
      isSpecialist: !!isSpecialist,
      serviceTypeSlug: serviceTypeSlug || null,
      requiresLocationTracking,
      details: {
        hours,
        rooms,
        bathrooms,
        hasProducts,
        customFormData: normalizedCustomFormData,
        customFormSummary,
        notes,
        scheduledDate,
      },
      address,
      pricing: {
        pricePerHour,
        estimated,
        specialistPremium,
        platformFee,
      },
    });

    // Despachar para o primeiro profissional disponível (fila inteligente)
    const io = req.app.get('io');
    if (io) {
      dispatchToNextProfessional(request._id, io);
    }

    res.status(201).json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao criar solicitação' });
  }
});

// GET /api/requests — listar solicitações
// Cliente: vê as próprias | Profissional: vê disponíveis na região
router.get('/', auth, async (req, res) => {
  try {
    let requests;
    if (req.user.userType === 'client') {
      requests = await ServiceRequest.find({ client: req.user._id })
        .populate('professional', 'name avatar professional.rating location')
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
        requests = await ServiceRequest.find({
          status: 'searching',
          currentAssignedTo: req.user._id,
          rejectedBy: { $ne: req.user._id },
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
  if (req.user.userType !== 'professional') {
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

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar status para preparação' });
  }
});

// PATCH /api/requests/:id/professional-on-the-way — profissional saiu para atendimento
router.patch('/:id/professional-on-the-way', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
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

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar status para a caminho' });
  }
});

// PATCH /api/requests/:id/professional-location — atualiza localização em tempo real durante deslocamento
router.patch('/:id/professional-location', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
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

// PATCH /api/requests/:id/accept — profissional aceita
router.patch('/:id/accept', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
    return res.status(403).json({ message: 'Apenas profissionais podem aceitar' });
  }

  try {
    const request = await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, status: 'searching' },
      {
        status: 'accepted',
        professional: req.user._id,
        acceptedAt: new Date(),
        clientConfirmedAt: null,
        $unset: { currentAssignedTo: '' },
      },
      { new: true }
    ).populate('client', 'name avatar phone');

    if (!request) {
      return res.status(400).json({ message: 'Solicitação não disponível' });
    }

    // Limpar timer da fila
    clearRequestTimer(req.params.id);

    // Buscar dados completos do profissional para mostrar ao cliente
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

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao aceitar serviço' });
  }
});

// PATCH /api/requests/:id/reject — profissional recusa
router.patch('/:id/reject', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
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
  if (req.user.userType !== 'client') {
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
  if (req.user.userType !== 'client') {
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

    // Processar pagamento e carteira de forma isolada para não bloquear o response
    let rewardApplied = { couponCode: null, rewardType: null, totalBenefit: 0, bonusAmount: 0, platformFeeDiscountAmount: 0, platformFeePercentApplied: 15 };
    let updatedRequest = request;
    try {
      const pricingConfig = await PricingConfig.getSingleton();
      const grossAmount = request.pricing.estimated;
      const defaultFeePercent = Number(pricingConfig.platformFeePercent || 15);
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

// PATCH /api/requests/:id/cancel — cliente cancela
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const filter = req.user.userType === 'client'
      ? { _id: req.params.id, client: req.user._id, status: { $in: ['searching', 'accepted', 'preparing', 'on_the_way'] } }
      : { _id: req.params.id, professional: req.user._id, status: { $in: ['accepted', 'preparing', 'on_the_way'] } };

    const request = await ServiceRequest.findOneAndUpdate(filter, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: req.body.reason || '',
    }, { new: true });

    if (!request) return res.status(400).json({ message: 'Não foi possível cancelar' });

    // Limpar timer da fila ao cancelar
    clearRequestTimer(req.params.id);
    await closeServiceChatForRequest(req.params.id, req.body.reason || 'Serviço cancelado');

    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao cancelar' });
  }
});

// POST /api/requests/:id/review — avaliação mútua após conclusão
// Cliente avalia profissional | Profissional avalia cliente
router.post('/:id/review', auth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Avaliação deve ser entre 1 e 5' });
  }

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
