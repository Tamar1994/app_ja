const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Review = require('../models/Review');

const router = express.Router();

// GET /api/users/me — perfil do usuário logado
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/users/me — atualizar perfil
router.patch('/me', auth, async (req, res) => {
  const allowed = ['name', 'phone', 'avatar'];
  if (req.user.userType === 'professional') {
    allowed.push('professional');
  }

  const updates = {};
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  try {
    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });
    res.json({ user });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar perfil' });
  }
});

// PATCH /api/users/push-token — salvar token de push notification
router.patch('/push-token', auth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message: 'Token obrigatório' });
  try {
    await User.findByIdAndUpdate(req.user._id, { pushToken: token });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'Erro ao salvar token' });
  }
});

// PATCH /api/users/me/location — atualizar localização (profissional)
router.patch('/me/location', auth, async (req, res) => {
  const { longitude, latitude } = req.body;
  if (longitude === undefined || latitude === undefined) {
    return res.status(400).json({ message: 'Coordenadas são obrigatórias' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { location: { type: 'Point', coordinates: [longitude, latitude] } },
      { new: true }
    );
    res.json({ location: user.location });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar localização' });
  }
});

// PATCH /api/users/me/availability — profissional liga/desliga disponibilidade
router.patch('/me/availability', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
    return res.status(403).json({ message: 'Apenas profissionais podem alterar disponibilidade' });
  }

  const { isAvailable } = req.body;
  try {
    await User.findByIdAndUpdate(req.user._id, { 'professional.isAvailable': isAvailable });
    res.json({ isAvailable });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar disponibilidade' });
  }
});

// GET /api/users/:id/reviews — avaliações de um profissional
router.get('/:id/reviews', auth, async (req, res) => {
  try {
    const reviews = await Review.find({ reviewed: req.params.id })
      .populate('reviewer', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ reviews });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar avaliações' });
  }
});

module.exports = router;
