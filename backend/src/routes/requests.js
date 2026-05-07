const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const ServiceRequest = require('../models/ServiceRequest');
const Review = require('../models/Review');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const router = express.Router();

// Preço base por hora (R$) — pode vir do profissional no futuro
const BASE_PRICE_PER_HOUR = 35;
const PLATFORM_FEE_PERCENT = 15;

// POST /api/requests/estimate — estimar valor antes de contratar
router.post('/estimate', auth, async (req, res) => {
  const { hours, hasProducts } = req.body;
  if (!hours || hours < 2 || hours > 12) {
    return res.status(400).json({ message: 'Horas devem ser entre 2 e 12' });
  }

  let pricePerHour = BASE_PRICE_PER_HOUR;
  if (!hasProducts) pricePerHour += 5; // profissional traz produtos

  const estimated = pricePerHour * hours;
  const platformFee = (estimated * PLATFORM_FEE_PERCENT) / 100;

  res.json({
    pricePerHour,
    hours,
    estimated,
    platformFee,
    total: estimated,
  });
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

  const { hours, rooms, bathrooms, hasProducts, notes, address, scheduledDate } = req.body;

  let pricePerHour = BASE_PRICE_PER_HOUR;
  if (!hasProducts) pricePerHour += 5;
  const estimated = pricePerHour * hours;

  try {
    const request = await ServiceRequest.create({
      client: req.user._id,
      details: { hours, rooms, bathrooms, hasProducts, notes, scheduledDate },
      address,
      pricing: {
        pricePerHour,
        estimated,
        platformFee: PLATFORM_FEE_PERCENT,
      },
    });

    // Emitir evento para profissionais disponíveis com dados completos
    const io = req.app.get('io');
    if (io) {
      const populated = await ServiceRequest.findById(request._id)
        .populate('client', 'name avatar');
      io.to('professionals').emit('new_request', {
        requestId: request._id,
        client: { name: populated.client?.name || 'Cliente' },
        details: request.details,
        address: request.address,
        pricing: request.pricing,
      });
    }

    res.status(201).json({ request });
  } catch (err) {
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
      // Profissional vê solicitações em busca de profissional
      requests = await ServiceRequest.find({
        status: 'searching',
        rejectedBy: { $ne: req.user._id },
      })
        .populate('client', 'name avatar')
        .sort({ createdAt: -1 });
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
      { status: 'accepted', professional: req.user._id, acceptedAt: new Date() },
      { new: true }
    ).populate('client', 'name avatar phone');

    if (!request) {
      return res.status(400).json({ message: 'Solicitação não disponível' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client._id}`).emit('request_accepted', { request });
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
    });
    res.json({ message: 'Solicitação recusada' });
  } catch {
    res.status(500).json({ message: 'Erro ao recusar serviço' });
  }
});

// PATCH /api/requests/:id/start — profissional inicia o serviço
router.patch('/:id/start', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findOneAndUpdate(
      { _id: req.params.id, professional: req.user._id, status: 'accepted' },
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

    // Creditar carteira do profissional (85% do valor)
    const grossAmount = request.pricing.final || request.pricing.estimated;
    const feePercent = 15;
    const platformFee = (grossAmount * feePercent) / 100;
    const netAmount = grossAmount - platformFee;

    await Transaction.create({
      professional: req.user._id,
      serviceRequest: request._id,
      type: 'earning',
      grossAmount,
      platformFee,
      amount: netAmount,
      description: `Serviço concluído`,
    });

    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'professional.totalServicesCompleted': 1,
        'wallet.balance': netAmount,
        'wallet.totalEarned': netAmount,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client}`).emit('service_completed', { requestId: request._id });
    }

    res.json({ request });
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
