const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Review = require('../models/Review');

const router = express.Router();

// GET /api/users/me — perfil do usuário logado
router.get('/me', auth, async (req, res) => {
  // req.user vem do middleware auth — mas pode não ter os novos campos (professionalAddress, selfieUrl, etc.)
  // Busca fresh para garantir que todos os campos estejam presentes
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json({ user });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar perfil' });
  }
});

// POST /api/users/me/profiles — habilita um perfil adicional (client/professional)
router.post('/me/profiles', auth, async (req, res) => {
  const profile = String(req.body?.profile || '').trim().toLowerCase();
  if (!['client', 'professional'].includes(profile)) {
    return res.status(400).json({ message: 'Perfil inválido' });
  }

  try {
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) return res.status(404).json({ message: 'Usuário não encontrado' });

    if (profile === 'professional') {
      if (currentUser.userType === 'client') {
        // Cliente ativando perfil profissional: verificar se professionalVerification foi aprovada
        if (currentUser.professionalVerification?.status === 'approved') {
          currentUser.profileModes.professional = true;
          await currentUser.save();
          return res.json({ user: currentUser });
        }
        return res.status(403).json({
          message: 'Perfil profissional ainda não aprovado. Envie os documentos necessários.',
          professionalVerificationStatus: currentUser.professionalVerification?.status || 'not_started',
        });
      }
      // Profissional puro — fluxo existente
      if (!currentUser.profileModes?.professional) {
        currentUser.verificationStatus = 'pending_documents';
      }
    }

    currentUser.profileModes[profile] = true;
    await currentUser.save();

    res.json({ user: currentUser });
  } catch {
    res.status(500).json({ message: 'Erro ao habilitar perfil' });
  }
});

// PATCH /api/users/me/active-profile — alterna perfil ativo entre client/professional
router.patch('/me/active-profile', auth, async (req, res) => {
  const profile = String(req.body?.profile || '').trim().toLowerCase();
  if (!['client', 'professional'].includes(profile)) {
    return res.status(400).json({ message: 'Perfil inválido' });
  }

  try {
    const latestUser = await User.findById(req.user._id);
    if (!latestUser) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const hasProfile = Boolean(
      (profile === 'client' && latestUser.profileModes?.client)
      || (profile === 'professional' && latestUser.profileModes?.professional)
      || latestUser.userType === profile
    );

    if (!hasProfile) {
      return res.status(400).json({ message: 'Perfil ainda não habilitado para esta conta' });
    }

    latestUser.activeProfile = profile;
    latestUser.userType = profile;
    await latestUser.save();

    res.json({ user: latestUser });
  } catch {
    res.status(500).json({ message: 'Erro ao alternar perfil' });
  }
});

// PATCH /api/users/me — atualizar perfil
router.patch('/me', auth, async (req, res) => {
  const allowed = ['name', 'phone', 'avatar'];
  if (req.user.userType === 'professional' || req.user.profileModes?.professional) {
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

// PATCH /api/users/me/password — alterar senha
router.patch('/me/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres' });
  }
  try {
    const user = await User.findById(req.user._id).select('+password');
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ message: 'Senha atual incorreta' });

    user.password = newPassword; // o pre-save hook do modelo fará o hash
    await user.save();
    res.json({ message: 'Senha alterada com sucesso' });
  } catch {
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

// DELETE /api/users/me — excluir conta (requer senha para confirmar)
router.delete('/me', auth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'Senha obrigatória para excluir conta' });
  try {
    const user = await User.findById(req.user._id).select('+password');
    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ message: 'Senha incorreta' });

    await User.findByIdAndDelete(req.user._id);
    res.json({ message: 'Conta excluída com sucesso' });
  } catch {
    res.status(500).json({ message: 'Erro ao excluir conta' });
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
