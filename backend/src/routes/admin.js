const express = require('express');
const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');
const User = require('../models/User');
const SupportChat = require('../models/SupportChat');
const ServiceRequest = require('../models/ServiceRequest');
const ServiceType = require('../models/ServiceType');
const HelpTopic = require('../models/HelpTopic');
const PricingConfig = require('../models/PricingConfig');
const StripeConfig = require('../models/StripeConfig');
const TermsOfUse = require('../models/TermsOfUse');
const Coupon = require('../models/Coupon');
const CouponClaim = require('../models/CouponClaim');
const CouponRedemption = require('../models/CouponRedemption');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const { sendApprovalEmail, sendRejectionEmail } = require('../services/emailService');
const { tryAssignChat, onChatClosed, findBestOperator } = require('../utils/supportQueue');
const { normalizeCouponCode, generateCouponCode } = require('../services/couponService');

const router = express.Router();

const generateAdminToken = (id) =>
  jwt.sign({ id, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });

// ── AUTH ──────────────────────────────────────────────────────────
// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Dados incompletos' });
  try {
    const admin = await AdminUser.findOne({ email }).select('+password');
    if (!admin || !admin.isActive || !(await admin.comparePassword(password))) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    const token = generateAdminToken(admin._id);
    res.json({ token, admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

// POST /api/admin/seed — cria primeiro super_admin (usar 1x)
router.post('/seed', async (req, res) => {
  const count = await AdminUser.countDocuments();
  if (count > 0) return res.status(400).json({ message: 'Já existem admins cadastrados' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Preencha todos os campos' });
  const admin = await AdminUser.create({ name, email, password, role: 'super_admin' });

  // Seed dos tipos de serviço iniciais
  const defaultTypes = [
    { slug: 'diarista', name: 'Diarista', description: 'Limpeza e organização residencial', icon: 'home-outline', status: 'enabled', sortOrder: 1 },
    { slug: 'eletricista', name: 'Eletricista', description: 'Instalações e reparos elétricos', icon: 'flash-outline', status: 'disabled', sortOrder: 2 },
    { slug: 'encanador', name: 'Encanador', description: 'Reparos hidráulicos e vaza mentos', icon: 'water-outline', status: 'disabled', sortOrder: 3 },
    { slug: 'pintor', name: 'Pintor', description: 'Pintura interna e externa', icon: 'color-palette-outline', status: 'disabled', sortOrder: 4 },
    { slug: 'jardineiro', name: 'Jardineiro', description: 'Cuidados com jardim e plantas', icon: 'leaf-outline', status: 'disabled', sortOrder: 5 },
    { slug: 'cozinheiro', name: 'Cozinheiro', description: 'Preparo de refeições no lar', icon: 'restaurant-outline', status: 'disabled', sortOrder: 6 },
    { slug: 'montador', name: 'Montador de Móveis', description: 'Montagem e desmontagem de móveis', icon: 'construct-outline', status: 'disabled', sortOrder: 7 },
  ];
  for (const t of defaultTypes) {
    await ServiceType.findOneAndUpdate({ slug: t.slug }, t, { upsert: true });
  }

  res.status(201).json({ message: 'Super admin criado', email: admin.email });
});

// ── DASHBOARD ─────────────────────────────────────────────────────
// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [
      totalUsers, totalClients, totalProfessionals,
      pendingReview, approved, rejected,
      totalServices, activeServices, completedServices,
      openChats,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ userType: 'client' }),
      User.countDocuments({ userType: 'professional' }),
      User.countDocuments({ verificationStatus: 'pending_review' }),
      User.countDocuments({ verificationStatus: 'approved' }),
      User.countDocuments({ verificationStatus: 'rejected' }),
      ServiceRequest.countDocuments(),
      ServiceRequest.countDocuments({ status: { $in: ['accepted', 'in_progress'] } }),
      ServiceRequest.countDocuments({ status: 'completed' }),
      SupportChat.countDocuments({ status: { $in: ['waiting', 'assigned'] } }),
    ]);

    res.json({
      users: { total: totalUsers, clients: totalClients, professionals: totalProfessionals },
      verification: { pendingReview, approved, rejected },
      services: { total: totalServices, active: activeServices, completed: completedServices },
      support: { openChats },
    });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
});

// ── FILA DE APROVAÇÃO ─────────────────────────────────────────────
// GET /api/admin/approvals?page=1&limit=20
router.get('/approvals', adminAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  try {
    const users = await User.find({ verificationStatus: 'pending_review' })
      .select('name email phone userType cpf birthDate selfieUrl documentUrl createdAt')
      .sort({ createdAt: 1 }) // mais antigo primeiro
      .skip((page - 1) * limit)
      .limit(limit);
    const total = await User.countDocuments({ verificationStatus: 'pending_review' });
    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar fila' });
  }
});

// GET /api/admin/approvals/:id
router.get('/approvals/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name email phone userType cpf birthDate selfieUrl documentUrl createdAt verificationStatus');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar usuário' });
  }
});

// PATCH /api/admin/approvals/:id/approve
router.patch('/approvals/:id/approve', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    user.verificationStatus = 'approved';
    // Selfie vira foto de perfil
    if (user.selfieUrl) user.avatar = user.selfieUrl;
    await user.save();
    await sendApprovalEmail(user.email, user.name);
    const io = req.app.get('io');
    if (io) io.to(`user_${user._id}`).emit('account_approved', { userId: user._id });
    res.json({ message: 'Usuário aprovado', user });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao aprovar usuário' });
  }
});

// PATCH /api/admin/approvals/:id/reject
router.patch('/approvals/:id/reject', adminAuth, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ message: 'Informe o motivo da rejeição' });
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { verificationStatus: 'rejected', rejectionReason: reason },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    await sendRejectionEmail(user.email, user.name, reason);
    const io = req.app.get('io');
    if (io) io.to(`user_${user._id}`).emit('account_rejected', { userId: user._id, reason });
    res.json({ message: 'Usuário rejeitado', user });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao rejeitar usuário' });
  }
});

// ── USUÁRIOS ──────────────────────────────────────────────────────
// GET /api/admin/users?search=&type=&status=&page=1
router.get('/users', adminAuth, async (req, res) => {
  const { search, type, status, page = 1, limit = 20 } = req.query;
  const query = {};
  if (search) query.$or = [
    { name: { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
  ];
  if (type) query.userType = type;
  if (status) query.verificationStatus = status;
  try {
    const users = await User.find(query)
      .select('name email phone userType verificationStatus isActive createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await User.countDocuments(query);
    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

// PATCH /api/admin/users/:id/toggle-active
router.patch('/users/:id/toggle-active', adminAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ message: `Usuário ${user.isActive ? 'ativado' : 'desativado'}`, isActive: user.isActive });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao alterar status' });
  }
});

// ── ADMINS ────────────────────────────────────────────────────────
// GET /api/admin/admins
router.get('/admins', adminAuth, requireRole('super_admin'), async (req, res) => {
  const admins = await AdminUser.find().select('-password').sort({ createdAt: -1 });
  res.json(admins);
});

// POST /api/admin/admins
router.post('/admins', adminAuth, requireRole('super_admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Campos obrigatórios faltando' });
  try {
    const existing = await AdminUser.findOne({ email });
    if (existing) return res.status(400).json({ message: 'E-mail já cadastrado' });
    const admin = await AdminUser.create({ name, email, password, role: role || 'support' });
    res.status(201).json({ message: 'Admin criado', admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar admin' });
  }
});

// DELETE /api/admin/admins/:id
router.delete('/admins/:id', adminAuth, requireRole('super_admin'), async (req, res) => {
  if (req.params.id === req.admin._id.toString()) {
    return res.status(400).json({ message: 'Não é possível remover a si mesmo' });
  }
  await AdminUser.findByIdAndDelete(req.params.id);
  res.json({ message: 'Admin removido' });
});

// ── SUPORTE / CHAT ────────────────────────────────────────────────
// GET /api/admin/chats?status=open
router.get('/chats', adminAuth, async (req, res) => {
  const { status } = req.query;
  const query = status ? { status } : {};
  try {
    const chats = await SupportChat.find(query)
      .populate('userId', 'name email userType')
      .populate('assignedTo', 'name')
      .sort({ updatedAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar chats' });
  }
});

// GET /api/admin/chats/:id
router.get('/chats/:id', adminAuth, async (req, res) => {
  try {
    const chat = await SupportChat.findById(req.params.id)
      .populate('userId', 'name email userType')
      .populate('assignedTo', 'name email');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar chat' });
  }
});

// POST /api/admin/chats/:id/message
router.post('/chats/:id/message', adminAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ message: 'Mensagem vazia' });
  try {
    const chat = await SupportChat.findByIdAndUpdate(
      req.params.id,
      {
        $push: { messages: { sender: 'support', adminId: req.admin._id, text: text.trim() } },
        assignedTo: req.admin._id,
      },
      { new: true }
    ).populate('userId', 'name');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

    // Notificar usuário via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${chat.userId._id}`).emit('support_message', {
        chatId: chat._id,
        text: text.trim(),
        sender: 'support',
        adminName: req.admin.name,
      });
    }

    res.json({ message: 'Mensagem enviada', chat });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao enviar mensagem' });
  }
});

// PATCH /api/admin/chats/:id/close
router.patch('/chats/:id/close', adminAuth, async (req, res) => {
  try {
    const chat = await SupportChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    const operatorId = chat.assignedTo;
    await SupportChat.findByIdAndUpdate(req.params.id, { status: 'closed' });
    const io = req.app.get('io');
    if (operatorId) await onChatClosed(operatorId, io);
    // Notificar cliente
    if (io) io.to(`user_${chat.userId}`).emit('chat_closed', { chatId: chat._id });
    res.json({ message: 'Chat encerrado' });
  } catch {
    res.status(500).json({ message: 'Erro ao encerrar chat' });
  }
});

// ── SUPORTE OPERADOR ──────────────────────────────────────────────
// PATCH /api/admin/support/toggle-status — ir online/offline
router.patch('/support/toggle-status', adminAuth, async (req, res) => {
  try {
    const admin = await AdminUser.findById(req.admin._id);
    if (admin.supportStatus === 'offline') {
      // Sincroniza contador ao ficar online
      const activeCount = await SupportChat.countDocuments({
        assignedTo: admin._id,
        status: 'assigned',
      });
      admin.supportStatus = 'online';
      admin.onlineAt = new Date();
      admin.activeSupportChats = activeCount;
      await admin.save();

      // Puxar da fila até completar 5 chats
      const io = req.app.get('io');
      while (admin.activeSupportChats < 5) {
        const next = await SupportChat.findOne({ status: 'waiting' }).sort({ queuedAt: 1 });
        if (!next) break;
        const result = await tryAssignChat(next._id, io);
        if (!result) break;
        admin.activeSupportChats++;
      }

      res.json({ supportStatus: 'online', message: 'Você está online e recebendo atendimentos' });
    } else {
      admin.supportStatus = 'offline';
      await admin.save();
      res.json({ supportStatus: 'offline', message: 'Você está offline' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao alterar status' });
  }
});

// GET /api/admin/support/status — status atual do operador
router.get('/support/status', adminAuth, async (req, res) => {
  try {
    const admin = await AdminUser.findById(req.admin._id).select('supportStatus onlineAt activeSupportChats');
    const waitingCount = await SupportChat.countDocuments({ status: 'waiting' });
    res.json({ ...admin.toObject(), waitingCount });
  } catch {
    res.status(500).json({ message: 'Erro' });
  }
});

// GET /api/admin/support/queue — fila de espera global
router.get('/support/queue', adminAuth, async (req, res) => {
  try {
    const chats = await SupportChat.find({ status: 'waiting' })
      .populate('userId', 'name email avatar')
      .sort({ queuedAt: 1 })
      .limit(50);
    res.json({ queue: chats });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar fila' });
  }
});

// GET /api/admin/support/my-chats — chats atribuídos ao operador logado
router.get('/support/my-chats', adminAuth, async (req, res) => {
  try {
    const chats = await SupportChat.find({
      assignedTo: req.admin._id,
      status: 'assigned',
    }).populate('userId', 'name email avatar').sort({ assignedAt: -1 });
    res.json({ chats });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar meus chats' });
  }
});

// GET /api/admin/support/chats/:id — detalhes de um chat
router.get('/support/chats/:id', adminAuth, async (req, res) => {
  try {
    const chat = await SupportChat.findById(req.params.id)
      .populate('userId', 'name email avatar')
      .populate('assignedTo', 'name');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    res.json({ chat });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chat' });
  }
});

// POST /api/admin/support/chats/:id/message — operador envia mensagem
router.post('/support/chats/:id/message', adminAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ message: 'Mensagem vazia' });
  try {
    const chat = await SupportChat.findByIdAndUpdate(
      req.params.id,
      {
        $push: { messages: { sender: 'support', adminId: req.admin._id, text: text.trim() } },
        assignedTo: req.admin._id,
        $set: { status: 'assigned' },
      },
      { new: true }
    ).populate('userId', 'name');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${chat.userId._id}`).emit('support_message', {
        chatId: chat._id,
        text: text.trim(),
        sender: 'support',
        adminName: req.admin.name,
      });
    }
    res.json({ message: 'Mensagem enviada' });
  } catch {
    res.status(500).json({ message: 'Erro ao enviar mensagem' });
  }
});

// PATCH /api/admin/support/chats/:id/close — encerrar chat (operador)
router.patch('/support/chats/:id/close', adminAuth, async (req, res) => {
  try {
    const chat = await SupportChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    const operatorId = chat.assignedTo || req.admin._id;
    await SupportChat.findByIdAndUpdate(req.params.id, { status: 'closed' });
    const io = req.app.get('io');
    await onChatClosed(operatorId, io);
    if (io) io.to(`user_${chat.userId}`).emit('chat_closed', { chatId: chat._id });
    res.json({ message: 'Atendimento encerrado' });
  } catch {
    res.status(500).json({ message: 'Erro ao encerrar chat' });
  }
});

// GET /api/admin/support/operators — operadores online
router.get('/support/operators', adminAuth, async (req, res) => {
  try {
    const operators = await AdminUser.find({ supportStatus: 'online', isActive: true })
      .select('name role activeSupportChats onlineAt')
      .sort({ activeSupportChats: 1, onlineAt: 1 });
    res.json({ operators });
  } catch {
    res.status(500).json({ message: 'Erro' });
  }
});

// ── CENTRAL DE AJUDA (admin CRUD) ─────────────────────────────────
// GET /api/admin/help — todos os tópicos (incl. inativos)
router.get('/help', adminAuth, async (req, res) => {
  try {
    const topics = await HelpTopic.find().sort({ sortOrder: 1, title: 1 });
    res.json({ topics });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar tópicos' });
  }
});

// POST /api/admin/help — criar tópico
router.post('/help', adminAuth, async (req, res) => {
  const { title, description, icon, sortOrder, isActive } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: 'Título é obrigatório' });
  try {
    const topic = await HelpTopic.create({
      title: title.trim(),
      description: description || '',
      icon: icon || '❓',
      sortOrder: sortOrder ?? 0,
      isActive: isActive !== false,
    });
    res.status(201).json({ topic });
  } catch {
    res.status(500).json({ message: 'Erro ao criar tópico' });
  }
});

// PATCH /api/admin/help/:id — atualizar tópico
router.patch('/help/:id', adminAuth, async (req, res) => {
  try {
    const topic = await HelpTopic.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!topic) return res.status(404).json({ message: 'Tópico não encontrado' });
    res.json({ topic });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar tópico' });
  }
});

// DELETE /api/admin/help/:id — deletar tópico
router.delete('/help/:id', adminAuth, async (req, res) => {
  try {
    await HelpTopic.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tópico removido' });
  } catch {
    res.status(500).json({ message: 'Erro ao remover tópico' });
  }
});

// POST /api/admin/help/:id/items — adicionar item
router.post('/help/:id/items', adminAuth, async (req, res) => {
  const { question, answer, sortOrder } = req.body;
  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ message: 'Pergunta e resposta são obrigatórias' });
  }
  try {
    const topic = await HelpTopic.findByIdAndUpdate(
      req.params.id,
      { $push: { items: { question: question.trim(), answer: answer.trim(), sortOrder: sortOrder ?? 0 } } },
      { new: true }
    );
    if (!topic) return res.status(404).json({ message: 'Tópico não encontrado' });
    res.json({ topic });
  } catch {
    res.status(500).json({ message: 'Erro ao adicionar item' });
  }
});

// PATCH /api/admin/help/:id/items/:itemId — atualizar item
router.patch('/help/:id/items/:itemId', adminAuth, async (req, res) => {
  const { question, answer, sortOrder } = req.body;
  try {
    const update = {};
    if (question) update['items.$.question'] = question.trim();
    if (answer) update['items.$.answer'] = answer.trim();
    if (sortOrder !== undefined) update['items.$.sortOrder'] = sortOrder;
    const topic = await HelpTopic.findOneAndUpdate(
      { _id: req.params.id, 'items._id': req.params.itemId },
      { $set: update },
      { new: true }
    );
    if (!topic) return res.status(404).json({ message: 'Item não encontrado' });
    res.json({ topic });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar item' });
  }
});

// DELETE /api/admin/help/:id/items/:itemId — remover item
router.delete('/help/:id/items/:itemId', adminAuth, async (req, res) => {
  try {
    const topic = await HelpTopic.findByIdAndUpdate(
      req.params.id,
      { $pull: { items: { _id: req.params.itemId } } },
      { new: true }
    );
    if (!topic) return res.status(404).json({ message: 'Tópico não encontrado' });
    res.json({ topic });
  } catch {
    res.status(500).json({ message: 'Erro ao remover item' });
  }
});

// ── CONFIGURAÇÃO DE PREÇOS ──────────────────────────────────────────────────
// GET /api/admin/pricing
router.get('/pricing', adminAuth, async (req, res) => {
  try {
    const config = await PricingConfig.getSingleton();
    res.json({ config });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar configurações de preço' });
  }
});

// PATCH /api/admin/pricing
router.patch('/pricing', adminAuth, async (req, res) => {
  const {
    basePricePerHour,
    serviceBasePrices,
    platformFeePercent,
    productsSurcharge,
    minHours,
    maxHours,
    hoursOptions,
  } = req.body;
  try {
    const config = await PricingConfig.getSingleton();
    if (basePricePerHour !== undefined) config.basePricePerHour = basePricePerHour;
    if (serviceBasePrices !== undefined && typeof serviceBasePrices === 'object' && serviceBasePrices !== null) {
      const cleanMap = {};
      Object.entries(serviceBasePrices).forEach(([slug, value]) => {
        const n = Number(value);
        if (!Number.isNaN(n) && n > 0) cleanMap[slug] = n;
      });
      config.serviceBasePrices = cleanMap;
    }
    if (platformFeePercent !== undefined) config.platformFeePercent = platformFeePercent;
    if (productsSurcharge !== undefined) config.productsSurcharge = productsSurcharge;
    if (minHours !== undefined) config.minHours = minHours;
    if (maxHours !== undefined) config.maxHours = maxHours;
    if (hoursOptions !== undefined) config.hoursOptions = hoursOptions;
    await config.save();
    res.json({ message: 'Configuração salva', config });
  } catch {
    res.status(500).json({ message: 'Erro ao salvar configurações de preço' });
  }
});

// ── STRIPE CONFIG ────────────────────────────────────────────────
// GET /api/admin/stripe-config
router.get('/stripe-config', adminAuth, async (req, res) => {
  try {
    const config = await StripeConfig.getSingleton();
    const hasTestKeys = !!(process.env.STRIPE_SECRET_KEY_TEST && process.env.STRIPE_PUBLISHABLE_KEY_TEST);
    const hasProdKeys = !!(process.env.STRIPE_SECRET_KEY_PROD && process.env.STRIPE_PUBLISHABLE_KEY_PROD);
    res.json({
      mode: config.mode,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy,
      hasTestKeys,
      hasProdKeys,
    });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar configuração Stripe' });
  }
});

// PATCH /api/admin/stripe-config
router.patch('/stripe-config', adminAuth, requireRole('super_admin'), async (req, res) => {
  const { mode } = req.body;
  if (!['test', 'production'].includes(mode)) {
    return res.status(400).json({ message: 'Modo inválido. Use "test" ou "production"' });
  }
  if (mode === 'production') {
    if (!process.env.STRIPE_SECRET_KEY_PROD || !process.env.STRIPE_PUBLISHABLE_KEY_PROD) {
      return res.status(400).json({ message: 'Chaves de produção não configuradas no servidor' });
    }
  }
  try {
    const admin = await AdminUser.findById(req.admin.id);
    const config = await StripeConfig.getSingleton();
    config.mode = mode;
    config.updatedBy = admin?.name || 'Admin';
    await config.save();
    console.log(`💳 Stripe modo alterado para: ${mode} por ${config.updatedBy}`);
    res.json({ message: `Modo alterado para ${mode}`, mode });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar modo Stripe' });
  }
});

// ── TERMOS DE USO ─────────────────────────────────────────────────
// GET /api/admin/terms
router.get('/terms', adminAuth, async (req, res) => {
  try {
    const terms = await TermsOfUse.getSingleton();
    res.json({ content: terms.content, updatedAt: terms.updatedAt, updatedBy: terms.updatedBy });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar termos' });
  }
});

// PATCH /api/admin/terms
router.patch('/terms', adminAuth, async (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ message: 'Conteúdo é obrigatório' });
  try {
    const terms = await TermsOfUse.getSingleton();
    terms.content = content;
    terms.updatedBy = req.admin.name;
    await terms.save();
    res.json({ message: 'Termos atualizados!', updatedAt: terms.updatedAt });
  } catch {
    res.status(500).json({ message: 'Erro ao salvar termos' });
  }
});

// ── CUPONS DE DESCONTO ────────────────────────────────────────────
// GET /api/admin/coupons
router.get('/coupons', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .sort({ createdAt: -1 })
      .populate('specificUsers', 'name email userType');

    const couponIds = coupons.map((c) => c._id);
    const [redemptions, claims] = await Promise.all([
      CouponRedemption.aggregate([
        { $match: { coupon: { $in: couponIds } } },
        { $group: { _id: '$coupon', totalUsed: { $sum: 1 }, totalDiscount: { $sum: '$discountAmount' } } },
      ]),
      CouponClaim.aggregate([
        { $match: { coupon: { $in: couponIds } } },
        { $group: { _id: '$coupon', totalClaimed: { $sum: 1 } } },
      ]),
    ]);

    const usageByCoupon = new Map(redemptions.map((r) => [r._id.toString(), r]));
    const claimsByCoupon = new Map(claims.map((r) => [r._id.toString(), r]));

    res.json({
      coupons: coupons.map((coupon) => {
        const usage = usageByCoupon.get(coupon._id.toString()) || { totalUsed: 0, totalDiscount: 0 };
        const claim = claimsByCoupon.get(coupon._id.toString()) || { totalClaimed: 0 };
        return {
          ...coupon.toObject(),
          metrics: {
            totalUsed: usage.totalUsed,
            totalDiscount: usage.totalDiscount,
            totalClaimed: claim.totalClaimed,
          },
        };
      }),
    });
  } catch {
    res.status(500).json({ message: 'Erro ao listar cupons' });
  }
});

// POST /api/admin/coupons
router.post('/coupons', adminAuth, async (req, res) => {
  const {
    title,
    description,
    code,
    autoCode,
    discountType,
    discountValue,
    maxDiscount,
    minOrderValue,
    maxTotalUses,
    maxUsesPerUser,
    stackable,
    startsAt,
    endsAt,
    distributionType,
    specificUsers,
    isActive,
  } = req.body;

  if (!title || !discountType || !Number.isFinite(Number(discountValue))) {
    return res.status(400).json({ message: 'Campos obrigatórios: título, tipo de desconto e valor' });
  }

  try {
    const normalizedCode = autoCode || !code
      ? generateCouponCode('JA')
      : normalizeCouponCode(code);

    if (!normalizedCode) {
      return res.status(400).json({ message: 'Código inválido' });
    }

    const exists = await Coupon.findOne({ code: normalizedCode });
    if (exists) return res.status(400).json({ message: 'Já existe um cupom com esse código' });

    const coupon = await Coupon.create({
      title,
      description,
      code: normalizedCode,
      discountType,
      discountValue: Number(discountValue),
      maxDiscount: maxDiscount === null || maxDiscount === undefined || maxDiscount === '' ? null : Number(maxDiscount),
      minOrderValue: minOrderValue === null || minOrderValue === undefined || minOrderValue === '' ? 0 : Number(minOrderValue),
      maxTotalUses: maxTotalUses === null || maxTotalUses === undefined || maxTotalUses === '' ? null : Number(maxTotalUses),
      maxUsesPerUser: maxUsesPerUser === null || maxUsesPerUser === undefined || maxUsesPerUser === '' ? 1 : Number(maxUsesPerUser),
      stackable: !!stackable,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      distributionType: distributionType || 'none',
      specificUsers: Array.isArray(specificUsers) ? specificUsers : [],
      isActive: isActive !== false,
      createdBy: req.admin?.name || 'Admin',
    });

    res.status(201).json({ message: 'Cupom criado com sucesso', coupon });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Código de cupom já existe' });
    }
    res.status(500).json({ message: 'Erro ao criar cupom' });
  }
});

// PATCH /api/admin/coupons/:id
router.patch('/coupons/:id', adminAuth, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.code) updates.code = normalizeCouponCode(updates.code);
    if (updates.discountValue !== undefined) updates.discountValue = Number(updates.discountValue);
    if (updates.maxDiscount !== undefined && updates.maxDiscount !== null && updates.maxDiscount !== '') updates.maxDiscount = Number(updates.maxDiscount);
    if (updates.minOrderValue !== undefined) updates.minOrderValue = Number(updates.minOrderValue || 0);
    if (updates.maxTotalUses !== undefined && updates.maxTotalUses !== null && updates.maxTotalUses !== '') updates.maxTotalUses = Number(updates.maxTotalUses);
    if (updates.maxUsesPerUser !== undefined && updates.maxUsesPerUser !== null && updates.maxUsesPerUser !== '') updates.maxUsesPerUser = Number(updates.maxUsesPerUser);

    const coupon = await Coupon.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ message: 'Cupom não encontrado' });

    res.json({ message: 'Cupom atualizado', coupon });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Código de cupom já existe' });
    }
    res.status(500).json({ message: 'Erro ao atualizar cupom' });
  }
});

// PATCH /api/admin/coupons/:id/distribute
router.patch('/coupons/:id/distribute', adminAuth, async (req, res) => {
  const { distributionType, userIds } = req.body;
  if (!distributionType || !['none', 'all', 'clients', 'professionals', 'specific'].includes(distributionType)) {
    return res.status(400).json({ message: 'distributionType inválido' });
  }
  if (distributionType === 'specific' && (!Array.isArray(userIds) || userIds.length === 0)) {
    return res.status(400).json({ message: 'Informe os usuários para distribuição específica' });
  }

  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Cupom não encontrado' });

    coupon.distributionType = distributionType;
    coupon.specificUsers = distributionType === 'specific' ? userIds : [];
    await coupon.save();

    if (distributionType === 'specific') {
      const ops = userIds.map((uid) => ({
        updateOne: {
          filter: { coupon: coupon._id, user: uid },
          update: { $setOnInsert: { claimedVia: 'distribution' } },
          upsert: true,
        },
      }));
      if (ops.length) await CouponClaim.bulkWrite(ops, { ordered: false });
    }

    res.json({ message: 'Distribuição de cupom atualizada', coupon });
  } catch {
    res.status(500).json({ message: 'Erro ao distribuir cupom' });
  }
});

// PATCH /api/admin/coupons/:id/toggle
router.patch('/coupons/:id/toggle', adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Cupom não encontrado' });
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ message: coupon.isActive ? 'Cupom ativado' : 'Cupom desativado', coupon });
  } catch {
    res.status(500).json({ message: 'Erro ao alterar status do cupom' });
  }
});

module.exports = router;
