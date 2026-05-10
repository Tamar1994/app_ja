const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const AdminUser = require('../models/AdminUser');
const SupportChat = require('../models/SupportChat');
const ServiceRequest = require('../models/ServiceRequest');
const Coupon = require('../models/Coupon');
const CouponClaim = require('../models/CouponClaim');
const SupportCouponRelease = require('../models/SupportCouponRelease');
const PauseType = require('../models/PauseType');
const { adminAuth, ADMIN_PERMISSIONS, hasPermission } = require('../middleware/adminAuth');
const { tryAssignChat, onChatClosed } = require('../utils/supportQueue');

const router = express.Router();

const MAX_ACTIVE_CHATS = 5;

function generateAdminToken(id) {
  return jwt.sign({ id, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

function canUseSupportSystem(admin) {
  if (!admin || !admin.isActive) return false;
  if (admin.role !== 'support') return false;
  return hasPermission(admin, ADMIN_PERMISSIONS.SUPPORT_CHAT);
}

function isOperator(admin) {
  return canUseSupportSystem(admin) && admin.supportRole === 'operator';
}

function isSupervisor(admin) {
  return canUseSupportSystem(admin) && admin.supportRole === 'supervisor';
}

async function autoResumeIfPauseEnded(adminId) {
  const admin = await AdminUser.findById(adminId);
  if (!admin) return null;

  // Only auto-resume if pause ended but NOT yet 10 min overdue (that requires supervisor unlock)
  if (admin.supportStatus === 'paused' && admin.pauseEndsAt) {
    const overdueMins = (Date.now() - admin.pauseEndsAt.getTime()) / 60000;
    if (overdueMins >= 0 && overdueMins < 10) {
      admin.supportStatus = 'online';
      admin.pauseStartAt = null;
      admin.pauseEndsAt = null;
      admin.pauseRequestedAt = null;
      admin.pauseDurationMinutes = null;
      admin.pauseTypeId = null;
      await admin.save();
    }
  }

  return admin;
}

async function ensureActiveChatCount(adminId) {
  const activeCount = await SupportChat.countDocuments({
    assignedTo: adminId,
    status: 'assigned',
  });
  await AdminUser.findByIdAndUpdate(adminId, { activeSupportChats: activeCount });
  return activeCount;
}

async function fillOperatorCapacity(operatorId, io) {
  const operator = await AdminUser.findById(operatorId);
  if (!operator || !isOperator(operator) || operator.supportStatus !== 'online') return;

  let activeCount = await ensureActiveChatCount(operator._id);
  while (activeCount < MAX_ACTIVE_CHATS) {
    const next = await SupportChat.findOne({ status: 'waiting' }).sort({ priorityLevel: -1, queuedAt: 1 });
    if (!next) break;
    const result = await tryAssignChat(next._id, io);
    if (!result || String(result._id) !== String(operator._id)) break;
    activeCount += 1;
  }
}

// POST /api/support-system/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Dados incompletos' });

  try {
    const admin = await AdminUser.findOne({ email }).select('+password');
    if (!admin || !(await admin.comparePassword(password)) || !canUseSupportSystem(admin)) {
      return res.status(401).json({ message: 'Acesso negado ao sistema de suporte' });
    }

    const token = generateAdminToken(admin._id);
    res.json({
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        supportRole: admin.supportRole,
        supportSupervisor: admin.supportSupervisor,
        supportStatus: admin.supportStatus,
      },
    });
  } catch {
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

// Todas as demais rotas exigem token admin
router.use(adminAuth);

router.use(async (req, res, next) => {
  if (!canUseSupportSystem(req.admin)) {
    return res.status(403).json({ message: 'Sem acesso ao sistema de suporte' });
  }
  await autoResumeIfPauseEnded(req.admin._id);
  req.admin = await AdminUser.findById(req.admin._id);
  next();
});

// GET /api/support-system/me
router.get('/me', async (req, res) => {
  const activeChats = await ensureActiveChatCount(req.admin._id);
  const waitingCount = await SupportChat.countDocuments({ status: 'waiting' });
  const waitingP1Count = await SupportChat.countDocuments({ status: 'waiting', priority: 'p1' });

  const pauseEndsAt = req.admin.pauseEndsAt;
  let pauseLockedBySupervisor = false;
  if (req.admin.supportStatus === 'paused' && pauseEndsAt) {
    const overdueMins = (Date.now() - pauseEndsAt.getTime()) / 60000;
    pauseLockedBySupervisor = overdueMins >= 10;
  }

  res.json({
    admin: {
      id: req.admin._id,
      name: req.admin.name,
      email: req.admin.email,
      supportRole: req.admin.supportRole,
      supportSupervisor: req.admin.supportSupervisor,
      supportStatus: req.admin.supportStatus,
      pauseStartAt: req.admin.pauseStartAt,
      pauseEndsAt: req.admin.pauseEndsAt,
      pauseRequestedAt: req.admin.pauseRequestedAt,
      pauseDurationMinutes: req.admin.pauseDurationMinutes,
      pauseTypeId: req.admin.pauseTypeId,
      pauseLockedBySupervisor,
      activeSupportChats: activeChats,
    },
    waitingCount,
    waitingP1Count,
  });
});

// PATCH /api/support-system/operator/go-online
router.patch('/operator/go-online', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  req.admin.supportStatus = 'online';
  req.admin.onlineAt = new Date();
  req.admin.pauseStartAt = null;
  req.admin.pauseEndsAt = null;
  req.admin.pauseRequestedAt = null;
  req.admin.pauseDurationMinutes = null;
  req.admin.pauseTypeId = null;
  req.admin.activeSupportChats = await ensureActiveChatCount(req.admin._id);
  await req.admin.save();

  await fillOperatorCapacity(req.admin._id, req.app.get('io'));
  res.json({ message: 'Operador online', supportStatus: req.admin.supportStatus });
});

// PATCH /api/support-system/operator/request-pause
router.patch('/operator/request-pause', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const { pauseTypeId } = req.body;
  let durationMinutes;
  let resolvedPauseTypeId = null;

  if (pauseTypeId) {
    const pt = await PauseType.findOne({ _id: pauseTypeId, isActive: true });
    if (!pt) return res.status(400).json({ message: 'Tipo de pausa inválido ou inativo' });
    durationMinutes = pt.durationMinutes;
    resolvedPauseTypeId = pt._id;
  } else {
    durationMinutes = Math.max(1, Math.min(480, Number(req.body.durationMinutes || 10)));
  }

  const activeChats = await ensureActiveChatCount(req.admin._id);

  req.admin.pauseDurationMinutes = durationMinutes;
  req.admin.pauseTypeId = resolvedPauseTypeId;
  req.admin.pauseRequestedAt = new Date();

  if (activeChats > 0) {
    req.admin.supportStatus = 'pause_scheduled';
    await req.admin.save();
    return res.json({
      message: 'Pausa programada. Ela iniciará após finalizar os atendimentos atuais.',
      supportStatus: req.admin.supportStatus,
      activeChats,
    });
  }

  req.admin.supportStatus = 'paused';
  req.admin.pauseStartAt = new Date();
  req.admin.pauseEndsAt = new Date(Date.now() + durationMinutes * 60000);
  await req.admin.save();

  res.json({
    message: 'Pausa iniciada.',
    supportStatus: req.admin.supportStatus,
    pauseStartAt: req.admin.pauseStartAt,
    pauseEndsAt: req.admin.pauseEndsAt,
  });
});

// PATCH /api/support-system/operator/cancel-pause
router.patch('/operator/cancel-pause', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  req.admin.supportStatus = 'online';
  req.admin.pauseRequestedAt = null;
  req.admin.pauseDurationMinutes = null;
  req.admin.pauseTypeId = null;
  req.admin.pauseStartAt = null;
  req.admin.pauseEndsAt = null;
  await req.admin.save();

  await fillOperatorCapacity(req.admin._id, req.app.get('io'));
  res.json({ message: 'Pausa cancelada', supportStatus: req.admin.supportStatus });
});

// PATCH /api/support-system/operator/end-pause
router.patch('/operator/end-pause', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  // If locked by supervisor (>10min overdue), require supervisor password
  if (req.admin.supportStatus === 'paused' && req.admin.pauseEndsAt) {
    const overdueMins = (Date.now() - req.admin.pauseEndsAt.getTime()) / 60000;
    if (overdueMins >= 10) {
      return res.status(403).json({ message: 'Pausa bloqueada. Solicite ao supervisor para desbloquear.', locked: true });
    }
  }

  req.admin.supportStatus = 'online';
  req.admin.pauseRequestedAt = null;
  req.admin.pauseDurationMinutes = null;
  req.admin.pauseTypeId = null;
  req.admin.pauseStartAt = null;
  req.admin.pauseEndsAt = null;
  await req.admin.save();

  await fillOperatorCapacity(req.admin._id, req.app.get('io'));
  res.json({ message: 'Pausa encerrada', supportStatus: req.admin.supportStatus });
});

// GET /api/support-system/chats/mine
router.get('/chats/mine', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const chats = await SupportChat.find({ assignedTo: req.admin._id, status: 'assigned' })
    .populate('userId', 'name email userType')
    .sort({ priorityLevel: -1, assignedAt: -1 });
  res.json({ chats });
});

// GET /api/support-system/chats/queue
router.get('/chats/queue', async (req, res) => {
  if (!(isOperator(req.admin) || isSupervisor(req.admin))) return res.status(403).json({ message: 'Sem acesso' });

  const queue = await SupportChat.find({ status: 'waiting' })
    .populate('userId', 'name email userType')
    .sort({ priorityLevel: -1, queuedAt: 1 })
    .limit(100);
  res.json({ queue });
});

// GET /api/support-system/chats/:id
router.get('/chats/:id', async (req, res) => {
  const chat = await SupportChat.findById(req.params.id)
    .populate('userId', 'name email userType')
    .populate('assignedTo', 'name email supportRole');
  if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

  if (isOperator(req.admin) && chat.assignedTo && String(chat.assignedTo._id) !== String(req.admin._id)) {
    return res.status(403).json({ message: 'Sem acesso a este chat' });
  }

  if (isOperator(req.admin) && !chat.assignedTo && chat.status === 'waiting') {
    if (req.admin.supportStatus !== 'online') {
      return res.status(400).json({ message: 'Fique online para assumir novos chats' });
    }
    const assigned = await tryAssignChat(chat._id, req.app.get('io'));
    if (!assigned || String(assigned._id) !== String(req.admin._id)) {
      return res.status(409).json({ message: 'Este chat foi atribuído para outro operador' });
    }
  }

  const refreshed = await SupportChat.findById(req.params.id)
    .populate('userId', 'name email userType')
    .populate('assignedTo', 'name email supportRole');
  res.json({ chat: refreshed });
});

// POST /api/support-system/chats/:id/message
router.post('/chats/:id/message', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ message: 'Mensagem vazia' });

  const chat = await SupportChat.findById(req.params.id).populate('userId', 'name');
  if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

  if (chat.status !== 'assigned' || String(chat.assignedTo || '') !== String(req.admin._id)) {
    return res.status(403).json({ message: 'Você não está atendendo este chat' });
  }

  chat.messages.push({ sender: 'support', adminId: req.admin._id, text });
  await chat.save();

  const io = req.app.get('io');
  if (io) {
    io.to(`user_${chat.userId._id}`).emit('support_message', {
      chatId: chat._id,
      text,
      sender: 'support',
      adminName: req.admin.name,
    });
  }

  res.json({ message: 'Mensagem enviada' });
});

// PATCH /api/support-system/chats/:id/close
router.patch('/chats/:id/close', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const chat = await SupportChat.findById(req.params.id);
  if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
  if (String(chat.assignedTo || '') !== String(req.admin._id)) {
    return res.status(403).json({ message: 'Você não está atendendo este chat' });
  }

  chat.status = 'closed';
  chat.closedAt = new Date();
  await chat.save();

  const io = req.app.get('io');
  await onChatClosed(req.admin._id, io);

  const refreshed = await AdminUser.findById(req.admin._id);
  if (refreshed && refreshed.supportStatus === 'pause_scheduled') {
    const activeChats = await ensureActiveChatCount(req.admin._id);
    if (activeChats === 0) {
      const durationMinutes = Math.max(1, Math.min(180, Number(refreshed.pauseDurationMinutes || 10)));
      refreshed.supportStatus = 'paused';
      refreshed.pauseStartAt = new Date();
      refreshed.pauseEndsAt = new Date(Date.now() + durationMinutes * 60000);
      await refreshed.save();
    }
  }

  if (io) io.to(`user_${chat.userId}`).emit('chat_closed', { chatId: chat._id });
  res.json({ message: 'Chat encerrado' });
});

// GET /api/support-system/requests/search?q=&status=
router.get('/requests/search', async (req, res) => {
  if (!(isOperator(req.admin) || isSupervisor(req.admin))) return res.status(403).json({ message: 'Sem acesso' });

  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || 'all').trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));

  const query = {};
  if (status !== 'all') query.status = status;

  if (q) {
    const or = [];
    if (mongoose.Types.ObjectId.isValid(q)) {
      or.push({ _id: new mongoose.Types.ObjectId(q) });
    }

    const safeRegex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await require('../models/User').find({
      $or: [{ name: safeRegex }, { email: safeRegex }, { phone: safeRegex }],
    }).select('_id').limit(200);
    const userIds = users.map((u) => u._id);
    if (userIds.length) {
      or.push({ client: { $in: userIds } });
      or.push({ professional: { $in: userIds } });
    }

    or.push({ 'payment.transactionId': safeRegex });
    query.$or = or;
  }

  const requests = await ServiceRequest.find(query)
    .populate('client', 'name email phone')
    .populate('professional', 'name email phone')
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json({ items: requests });
});

// GET /api/support-system/supervisor/operators
router.get('/supervisor/operators', async (req, res) => {
  if (!isSupervisor(req.admin)) return res.status(403).json({ message: 'Somente supervisores' });

  const operators = await AdminUser.find({
    role: 'support',
    supportRole: 'operator',
    supportSupervisor: req.admin._id,
    isActive: true,
  }).select('name email supportStatus activeSupportChats pauseStartAt pauseEndsAt pauseRequestedAt pauseDurationMinutes onlineAt');

  const operatorIds = operators.map((op) => op._id);
  const openChats = await SupportChat.find({
    assignedTo: { $in: operatorIds },
    status: 'assigned',
  }).select('_id assignedTo userId subject priority assignedAt').populate('userId', 'name email');

  // Compute avg handling time from last 30 closed chats per operator
  const closedChats = await SupportChat.find({
    assignedTo: { $in: operatorIds },
    status: 'closed',
    assignedAt: { $ne: null },
    closedAt: { $ne: null },
  }).select('assignedTo assignedAt closedAt').sort({ closedAt: -1 }).limit(operatorIds.length * 30);

  const handlingByOp = {};
  closedChats.forEach((ch) => {
    const key = String(ch.assignedTo);
    if (!handlingByOp[key]) handlingByOp[key] = [];
    if (handlingByOp[key].length < 30) {
      handlingByOp[key].push((ch.closedAt - ch.assignedAt) / 1000);
    }
  });

  const grouped = {};
  openChats.forEach((chat) => {
    const key = String(chat.assignedTo);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(chat);
  });

  const now = Date.now();

  res.json({
    operators: operators.map((op) => {
      const key = String(op._id);
      const handlingTimes = handlingByOp[key] || [];
      const avgHandlingTimeSeconds = handlingTimes.length
        ? Math.round(handlingTimes.reduce((a, b) => a + b, 0) / handlingTimes.length)
        : null;

      // Pause time remaining in seconds (negative = overdue)
      let pauseSecondsRemaining = null;
      let pauseLockedBySupervisor = false;
      if (op.supportStatus === 'paused' && op.pauseEndsAt) {
        pauseSecondsRemaining = Math.round((op.pauseEndsAt.getTime() - now) / 1000);
        pauseLockedBySupervisor = pauseSecondsRemaining <= -600; // -10 min
      }

      return {
        ...op.toObject(),
        chats: grouped[key] || [],
        avgHandlingTimeSeconds,
        pauseSecondsRemaining,
        pauseLockedBySupervisor,
      };
    }),
  });
});

// GET /api/support-system/pause-types
router.get('/pause-types', async (req, res) => {
  try {
    const types = await PauseType.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.json({ pauseTypes: types });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar tipos de pausa' });
  }
});

// PATCH /api/support-system/supervisor/operators/:id/unlock-pause
router.patch('/supervisor/operators/:id/unlock-pause', async (req, res) => {
  if (!isSupervisor(req.admin)) return res.status(403).json({ message: 'Somente supervisores' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'Senha do supervisor é obrigatória' });

  // Validate supervisor password
  const supervisor = await AdminUser.findById(req.admin._id).select('+password');
  const valid = await supervisor.comparePassword(password);
  if (!valid) return res.status(401).json({ message: 'Senha incorreta' });

  const operator = await AdminUser.findOne({
    _id: req.params.id,
    supportRole: 'operator',
    supportSupervisor: req.admin._id,
  });
  if (!operator) return res.status(404).json({ message: 'Operador não encontrado' });
  if (operator.supportStatus !== 'paused') return res.status(400).json({ message: 'Operador não está em pausa' });

  operator.supportStatus = 'online';
  operator.pauseStartAt = null;
  operator.pauseEndsAt = null;
  operator.pauseRequestedAt = null;
  operator.pauseDurationMinutes = null;
  operator.pauseTypeId = null;
  await operator.save();

  await fillOperatorCapacity(operator._id, req.app.get('io'));
  res.json({ message: 'Pausa desbloqueada pelo supervisor', operatorId: operator._id });
});

// GET /api/support-system/coupons/available
router.get('/coupons/available', async (req, res) => {
  if (!(isOperator(req.admin) || isSupervisor(req.admin))) return res.status(403).json({ message: 'Sem acesso' });

  const coupons = await Coupon.find({ isActive: true, usageScope: 'checkout' })
    .select('code title discountType discountValue maxDiscount minOrderValue endsAt distributionType')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ coupons });
});

// POST /api/support-system/coupon-releases/request
router.post('/coupon-releases/request', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const { couponId, targetUserId, reason } = req.body;
  if (!couponId || !targetUserId) {
    return res.status(400).json({ message: 'couponId e targetUserId são obrigatórios' });
  }

  if (!req.admin.supportSupervisor) {
    return res.status(400).json({ message: 'Operador sem supervisor vinculado' });
  }

  const [coupon, targetUser] = await Promise.all([
    Coupon.findById(couponId).select('_id code title isActive usageScope'),
    require('../models/User').findById(targetUserId).select('_id name email userType'),
  ]);

  if (!coupon || !coupon.isActive || coupon.usageScope !== 'checkout') {
    return res.status(400).json({ message: 'Cupom inválido para operação' });
  }
  if (!targetUser) {
    return res.status(404).json({ message: 'Usuário alvo não encontrado' });
  }

  const release = await SupportCouponRelease.create({
    coupon: coupon._id,
    targetUser: targetUser._id,
    requestedBy: req.admin._id,
    supervisor: req.admin.supportSupervisor,
    status: 'pending',
    reason: String(reason || '').trim(),
  });

  res.status(201).json({
    message: 'Solicitação de liberação enviada para aprovação do supervisor',
    release,
  });
});

// GET /api/support-system/coupon-releases/mine
router.get('/coupon-releases/mine', async (req, res) => {
  if (!isOperator(req.admin)) return res.status(403).json({ message: 'Somente operadores' });

  const releases = await SupportCouponRelease.find({ requestedBy: req.admin._id })
    .populate('coupon', 'code title discountType discountValue')
    .populate('targetUser', 'name email userType')
    .populate('supervisor', 'name email')
    .populate('processedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(200);

  res.json({ releases });
});

// GET /api/support-system/supervisor/coupon-releases
router.get('/supervisor/coupon-releases', async (req, res) => {
  if (!isSupervisor(req.admin)) return res.status(403).json({ message: 'Somente supervisores' });

  const status = String(req.query.status || 'pending');
  const query = { supervisor: req.admin._id };
  if (status !== 'all') query.status = status;

  const releases = await SupportCouponRelease.find(query)
    .populate('coupon', 'code title discountType discountValue')
    .populate('targetUser', 'name email userType')
    .populate('requestedBy', 'name email')
    .populate('processedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(300);

  res.json({ releases });
});

// PATCH /api/support-system/supervisor/coupon-releases/:id/approve
router.patch('/supervisor/coupon-releases/:id/approve', async (req, res) => {
  if (!isSupervisor(req.admin)) return res.status(403).json({ message: 'Somente supervisores' });

  const release = await SupportCouponRelease.findOne({ _id: req.params.id, supervisor: req.admin._id })
    .populate('coupon', 'code title')
    .populate('targetUser', '_id name email');

  if (!release) return res.status(404).json({ message: 'Solicitação não encontrada' });
  if (release.status !== 'pending') return res.status(400).json({ message: 'Solicitação já processada' });

  const existingClaim = await CouponClaim.findOne({ coupon: release.coupon._id, user: release.targetUser._id });
  if (!existingClaim) {
    await CouponClaim.create({
      coupon: release.coupon._id,
      user: release.targetUser._id,
      claimedVia: 'admin',
    });
  }

  release.status = 'approved';
  release.approvedAt = new Date();
  release.processedBy = req.admin._id;
  release.supervisorNote = String(req.body.note || '').trim();
  await release.save();

  res.json({ message: 'Liberação aprovada e cupom enviado para a carteira do usuário', release });
});

// PATCH /api/support-system/supervisor/coupon-releases/:id/reject
router.patch('/supervisor/coupon-releases/:id/reject', async (req, res) => {
  if (!isSupervisor(req.admin)) return res.status(403).json({ message: 'Somente supervisores' });

  const release = await SupportCouponRelease.findOne({ _id: req.params.id, supervisor: req.admin._id });
  if (!release) return res.status(404).json({ message: 'Solicitação não encontrada' });
  if (release.status !== 'pending') return res.status(400).json({ message: 'Solicitação já processada' });

  release.status = 'rejected';
  release.rejectedAt = new Date();
  release.processedBy = req.admin._id;
  release.supervisorNote = String(req.body.note || '').trim();
  await release.save();

  res.json({ message: 'Solicitação recusada', release });
});

module.exports = router;
