const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const ServiceRequest = require('../models/ServiceRequest');
const Review = require('../models/Review');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const CouponRedemption = require('../models/CouponRedemption');
const { dispatchToNextProfessional, clearRequestTimer } = require('../utils/requestQueue');
const { ensureServiceChatForRequest, closeServiceChatForRequest } = require('../utils/serviceChat');
const { resolveProfessionalRewardForCompletion } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');

const router = express.Router();

// POST /api/requests/estimate — estimar valor antes de contratar
router.post('/estimate', auth, async (req, res) => {
  const { hours, hasProducts, serviceTypeSlug, customFormData } = req.body;
  try {
    const pricing = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });

    res.json({
      pricePerHour: pricing.pricePerHour,
      hours,
      estimated: pricing.estimated,
      platformFee: pricing.platformFee,
      total: pricing.estimated,
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
  body('hours').isInt({ min: 2, max: 12 }),
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
  } = req.body;

  let pricePerHour, estimated, platformFee;
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
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    pricePerHour = 35;
    if (!hasProducts) pricePerHour += 5;
    estimated = pricePerHour * hours;
    platformFee = (estimated * 15) / 100;
    normalizedCustomFormData = customFormData && typeof customFormData === 'object' ? customFormData : {};
    customFormSummary = [];
  }

  try {
    const request = await ServiceRequest.create({
      client: req.user._id,
      serviceTypeSlug: serviceTypeSlug || null,
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
        .populate('professional', 'name avatar professional.rating')
        .sort({ createdAt: -1 });
    } else {
      const { scope = 'available' } = req.query;
      if (scope === 'my-services') {
        requests = await ServiceRequest.find({
          professional: req.user._id,
          status: { $in: ['accepted', 'in_progress', 'completed'] },
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
      .populate('professional', 'name avatar phone professional');
    if (!request) return res.status(404).json({ message: 'Solicitação não encontrada' });
    res.json({ request });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar solicitação' });
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
        status: 'accepted',
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

    const pricingConfig = await PricingConfig.getSingleton();

    // Creditar carteira do profissional com possível incentivo de cupom
    const grossAmount = request.pricing.final || request.pricing.estimated;
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

    const updatedRequest = await ServiceRequest.findByIdAndUpdate(request._id, {
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

    await closeServiceChatForRequest(request._id, 'Serviço concluído');

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('service_completed', { requestId: request._id });
    }

    res.json({
      request: updatedRequest || request,
      rewardApplied: {
        couponCode: reward.coupon ? reward.coupon.code : null,
        rewardType: reward.rewardType,
        totalBenefit: reward.totalBenefit,
        bonusAmount: reward.bonusAmount,
        platformFeeDiscountAmount: reward.feeDiscountAmount,
        platformFeePercentApplied: reward.feePercentApplied,
      },
    });
  } catch {
    res.status(500).json({ message: 'Erro ao concluir serviço' });
  }
});

// PATCH /api/requests/:id/cancel — cliente cancela
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const filter = req.user.userType === 'client'
      ? { _id: req.params.id, client: req.user._id, status: { $in: ['searching', 'accepted'] } }
      : { _id: req.params.id, professional: req.user._id, status: 'accepted' };

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

// POST /api/requests/:id/review — avaliar após conclusão
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

    // Cliente avalia profissional
    const reviewed = request.professional;
    const existing = await Review.findOne({ serviceRequest: request._id, reviewer: req.user._id });
    if (existing) return res.status(400).json({ message: 'Você já avaliou este serviço' });

    const review = await Review.create({
      serviceRequest: request._id,
      reviewer: req.user._id,
      reviewed,
      rating,
      comment,
    });

    res.status(201).json({ review });
  } catch {
    res.status(500).json({ message: 'Erro ao avaliar' });
  }
});

module.exports = router;
