const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const SupportChat = require('../models/SupportChat');
const ServiceChat = require('../models/ServiceChat');
const ServiceRequest = require('../models/ServiceRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const ServiceType = require('../models/ServiceType');
const ServiceCoverageCity = require('../models/ServiceCoverageCity');
const HelpTopic = require('../models/HelpTopic');
const StripeConfig = require('../models/StripeConfig');
const TermsOfUse = require('../models/TermsOfUse');
const Waitlist = require('../models/Waitlist');
const Coupon = require('../models/Coupon');
const CouponClaim = require('../models/CouponClaim');
const CouponRedemption = require('../models/CouponRedemption');
const AuditLog = require('../models/AuditLog');
const SpecialistCertificate = require('../models/SpecialistCertificate');
const {
  adminAuth,
  requireRole,
  requirePermission,
  hasPermission,
  getEffectivePermissions,
  sanitizePermissions,
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_VALUES,
  DEFAULT_ROLE_PERMISSIONS,
} = require('../middleware/adminAuth');
const { sendApprovalEmail, sendRejectionEmail } = require('../services/emailService');
const { tryAssignChat, onChatClosed, findBestOperator } = require('../utils/supportQueue');
const { clearRequestTimer, sendExpoPush } = require('../utils/requestQueue');
const { normalizeCouponCode, generateCouponCode } = require('../services/couponService');
const { cleanupRequestUploads, deleteUploadFile } = require('../utils/uploadCleanup');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getStripeClientForAdmin() {
  const config = await StripeConfig.getSingleton();
  const isProd = config.mode === 'production';
  const secretKey = isProd ? process.env.STRIPE_SECRET_KEY_PROD : process.env.STRIPE_SECRET_KEY_TEST;
  if (!secretKey) {
    throw new Error(`Stripe ${isProd ? 'produção' : 'teste'} não configurado no servidor`);
  }
  return new Stripe(secretKey);
}

const permissionCatalog = [
  { key: ADMIN_PERMISSIONS.DASHBOARD, label: 'Dashboard', module: 'general' },
  { key: ADMIN_PERMISSIONS.SUPPORT_CHAT, label: 'Suporte / Chat', module: 'support' },
  { key: ADMIN_PERMISSIONS.FINANCIAL, label: 'Financeiro (saques/estornos)', module: 'financial' },
  { key: ADMIN_PERMISSIONS.USER_MANAGEMENT, label: 'Gestão de usuários', module: 'users' },
  { key: ADMIN_PERMISSIONS.SERVICE_MANAGEMENT, label: 'Profissões e serviços', module: 'service' },
  { key: ADMIN_PERMISSIONS.CONTENT_MANAGEMENT, label: 'Ajuda / Termos', module: 'content' },
  { key: ADMIN_PERMISSIONS.COUPON_MANAGEMENT, label: 'Cupons', module: 'coupon' },
  { key: ADMIN_PERMISSIONS.PAYMENT_MANAGEMENT, label: 'Pagamentos / Stripe', module: 'payment' },
  { key: ADMIN_PERMISSIONS.ACCESS_MANAGEMENT, label: 'Equipe admin / acessos', module: 'access' },
];

const withEffectivePermissions = (adminDoc) => {
  const raw = adminDoc.toObject ? adminDoc.toObject() : adminDoc;
  return {
    ...raw,
    effectivePermissions: getEffectivePermissions(raw),
  };
};

const getRolePermissionPreset = (role) => {
  if (role === 'super_admin') return [];
  const preset = DEFAULT_ROLE_PERMISSIONS[role] || [];
  return sanitizePermissions(preset);
};

const resolvePermissionsForRole = ({ role, permissions, applyRolePreset = false }) => {
  const sanitized = sanitizePermissions(permissions);
  if (applyRolePreset || sanitized.length === 0) {
    return getRolePermissionPreset(role);
  }
  return sanitized;
};

const csvCell = (value) => {
  const str = String(value == null ? '' : value);
  return `"${str.replace(/"/g, '""')}"`;
};

async function buildAuditQuery(req) {
  const moduleFilter = String(req.query.module || '').trim();
  const actor = String(req.query.actor || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const query = {};
  const canViewFinancial = hasPermission(req.admin, ADMIN_PERMISSIONS.FINANCIAL);
  const canViewAccess = hasPermission(req.admin, ADMIN_PERMISSIONS.ACCESS_MANAGEMENT);
  const canViewSupport = hasPermission(req.admin, ADMIN_PERMISSIONS.SUPPORT_CHAT);

  if (!canViewSupport && !canViewFinancial && !canViewAccess) {
    query.module = '__none__';
  } else if (!canViewFinancial && !canViewAccess && canViewSupport) {
    query.module = 'support';
  } else if (moduleFilter) {
    query.module = moduleFilter;
  }

  if (from || to) {
    query.createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) query.createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }
    if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
  }

  if (actor) {
    const actorOr = [];
    if (mongoose.Types.ObjectId.isValid(actor)) {
      actorOr.push({ actorAdminId: new mongoose.Types.ObjectId(actor) });
      actorOr.push({ actorUserId: new mongoose.Types.ObjectId(actor) });
    }
    const regex = new RegExp(escapeRegex(actor), 'i');
    const [admins, users] = await Promise.all([
      AdminUser.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').limit(200),
      User.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').limit(200),
    ]);
    const adminIds = admins.map((a) => a._id);
    const userIds = users.map((u) => u._id);
    if (adminIds.length) actorOr.push({ actorAdminId: { $in: adminIds } });
    if (userIds.length) actorOr.push({ actorUserId: { $in: userIds } });
    if (actorOr.length) query.$or = actorOr;
    else query.targetId = '__none__';
  }

  return query;
}

const uploadsRoot = path.join(__dirname, '../../uploads');
const withdrawalProofDir = path.join(uploadsRoot, 'withdrawal-proofs');
if (!fs.existsSync(withdrawalProofDir)) {
  fs.mkdirSync(withdrawalProofDir, { recursive: true });
}

const withdrawalProofStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, withdrawalProofDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `proof-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const withdrawalProofUpload = multer({
  storage: withdrawalProofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Comprovante deve ser JPG, PNG, WEBP ou PDF'));
    }
    cb(null, true);
  },
});

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
    res.json({
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: sanitizePermissions(admin.permissions),
        effectivePermissions: getEffectivePermissions(admin),
      },
    });
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
    {
      slug: 'diarista',
      name: 'Diarista',
      description: 'Limpeza e organização residencial',
      icon: 'home-outline',
      status: 'enabled',
      sortOrder: 1,
      checkoutFields: [
        {
          key: 'rooms',
          label: 'Cômodos',
          inputType: 'number',
          required: true,
          min: 1,
          max: 20,
          step: 1,
          defaultValue: 2,
          pricingEnabled: false,
          pricingMode: 'add_total',
          pricingAmount: 0,
          sortOrder: 1,
        },
        {
          key: 'bathrooms',
          label: 'Banheiros',
          inputType: 'number',
          required: true,
          min: 1,
          max: 10,
          step: 1,
          defaultValue: 1,
          pricingEnabled: false,
          pricingMode: 'add_total',
          pricingAmount: 0,
          sortOrder: 2,
        },
      ],
    },
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

  await ServiceCoverageCity.findOneAndUpdate(
    { normalizedCity: 'sao jose dos campos', normalizedState: 'sp' },
    {
      city: 'São José dos Campos',
      state: 'SP',
      normalizedCity: 'sao jose dos campos',
      normalizedState: 'sp',
      isActive: true,
      order: 0,
    },
    { upsert: true }
  );

  res.status(201).json({ message: 'Super admin criado', email: admin.email });
});

// ── DASHBOARD ─────────────────────────────────────────────────────
// GET /api/admin/stats
router.get('/stats', adminAuth, requirePermission(ADMIN_PERMISSIONS.DASHBOARD), async (req, res) => {
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

// ── FILA DE SAQUES (PIX MANUAL) ───────────────────────────────────
// GET /api/admin/withdrawals?status=pending&page=1&limit=20
router.get('/withdrawals', adminAuth, requirePermission(ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  const {
    status = 'pending',
    search = '',
    from = '',
    to = '',
    minAmount = '',
    maxAmount = '',
    page = 1,
    limit = 20,
  } = req.query;

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const query = status === 'all' ? {} : { status };

  const hasMinAmount = String(minAmount ?? '').trim() !== '';
  const hasMaxAmount = String(maxAmount ?? '').trim() !== '';
  const minAmountNumber = hasMinAmount ? Number(minAmount) : null;
  const maxAmountNumber = hasMaxAmount ? Number(maxAmount) : null;
  if ((hasMinAmount && Number.isFinite(minAmountNumber)) || (hasMaxAmount && Number.isFinite(maxAmountNumber))) {
    query.amount = {};
    if (hasMinAmount && Number.isFinite(minAmountNumber)) query.amount.$gte = minAmountNumber;
    if (hasMaxAmount && Number.isFinite(maxAmountNumber)) query.amount.$lte = maxAmountNumber;
  }

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
    query.requestedAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) query.requestedAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      query.requestedAt.$lte = toDate;
    }
  }

  try {
    const trimmedSearch = String(search || '').trim();
    if (trimmedSearch) {
      const searchRegex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchedUsers = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
          { cpf: searchRegex },
        ],
      }).select('_id').limit(200);

      const matchedUserIds = matchedUsers.map((u) => u._id);
      query.$or = [
        { pixKeyCpfSnapshot: searchRegex },
        ...(matchedUserIds.length ? [{ professional: { $in: matchedUserIds } }] : []),
      ];
    }

    const [items, total, grouped] = await Promise.all([
      WithdrawalRequest.find(query)
        .populate('professional', 'name email phone cpf')
        .populate('processedBy', 'name')
        .populate('transferProofUploadedBy', 'name')
        .sort({ requestedAt: 1, createdAt: 1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit),
      WithdrawalRequest.countDocuments(query),
      WithdrawalRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const counters = grouped.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, cancelled: 0 });

    res.json({
      withdrawals: items,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
      filters: {
        status,
        search: trimmedSearch,
        from,
        to,
        minAmount,
        maxAmount,
      },
      counters,
    });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar fila de saques' });
  }
});

// GET /api/admin/withdrawals/:id
router.get('/withdrawals/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id)
      .populate('professional', 'name email phone cpf wallet')
      .populate('processedBy', 'name email')
      .populate('transferProofUploadedBy', 'name email');

    if (!withdrawal) return res.status(404).json({ message: 'Solicitação de saque não encontrada' });

    res.json({ withdrawal });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar saque' });
  }
});

// PATCH /api/admin/withdrawals/:id/status
router.patch('/withdrawals/:id/status', adminAuth, requirePermission(ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  const { status, internalNote } = req.body;
  if (!['pending', 'processing', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido' });
  }

  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ message: 'Saque não encontrado' });

    if (withdrawal.status === 'completed' || withdrawal.status === 'cancelled') {
      return res.status(400).json({ message: 'Este saque já foi finalizado' });
    }

    if (status === 'cancelled') {
      const session = await mongoose.startSession();
      let cancelledWithdrawal = null;
      try {
        await session.withTransaction(async () => {
          cancelledWithdrawal = await WithdrawalRequest.findByIdAndUpdate(
            withdrawal._id,
            {
              status: 'cancelled',
              processedAt: new Date(),
              processedBy: req.admin._id,
              internalNote: internalNote || withdrawal.internalNote || '',
            },
            { new: true, session }
          );

          await User.findByIdAndUpdate(
            withdrawal.professional,
            { $inc: { 'wallet.balance': Number(withdrawal.amount || 0) } },
            { session }
          );

          await Transaction.create([{
            professional: withdrawal.professional,
            withdrawalRequest: withdrawal._id,
            type: 'earning',
            grossAmount: Number(withdrawal.amount || 0),
            platformFee: 0,
            amount: Number(withdrawal.amount || 0),
            status: 'available',
            description: 'Estorno de saque cancelado pelo admin',
          }], { session });
        });
      } finally {
        await session.endSession();
      }
      await logAudit({
        module: 'financial',
        action: 'withdrawal_cancelled',
        severity: 'high',
        actorType: 'admin',
        actorAdminId: req.admin._id,
        targetType: 'withdrawal_request',
        targetId: withdrawal._id,
        message: 'Saque cancelado e estornado pelo financeiro',
        metadata: {
          amount: Number(withdrawal.amount || 0),
          professionalId: String(withdrawal.professional),
          internalNote: internalNote || '',
        },
      });
      res.json({ message: 'Saque cancelado e valor estornado', withdrawal: cancelledWithdrawal });
      return;
    }

    const update = {
      status,
      processedBy: req.admin._id,
      processedAt: new Date(),
    };
    if (status === 'completed') update.completedAt = new Date();
    if (internalNote !== undefined) update.internalNote = internalNote;

    const updated = await WithdrawalRequest.findByIdAndUpdate(
      withdrawal._id,
      update,
      { new: true }
    );

    await logAudit({
      module: 'financial',
      action: 'withdrawal_status_updated',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'withdrawal_request',
      targetId: withdrawal._id,
      message: `Status de saque alterado para ${status}`,
      metadata: {
        fromStatus: withdrawal.status,
        toStatus: status,
        internalNote: internalNote || '',
      },
    });

    res.json({ message: 'Status do saque atualizado', withdrawal: updated });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar saque' });
  }
});

// POST /api/admin/withdrawals/:id/proof
router.post('/withdrawals/:id/proof', adminAuth, requirePermission(ADMIN_PERMISSIONS.FINANCIAL), withdrawalProofUpload.single('proof'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Arquivo de comprovante é obrigatório' });

  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal) {
      await cleanupRequestUploads(req);
      return res.status(404).json({ message: 'Saque não encontrado' });
    }

    const newProofUrl = `/uploads/withdrawal-proofs/${req.file.filename}`;
    const oldProofUrl = withdrawal.transferProofUrl;

    withdrawal.transferProofUrl = newProofUrl;
    withdrawal.transferProofUploadedAt = new Date();
    withdrawal.transferProofUploadedBy = req.admin._id;
    await withdrawal.save();

    if (oldProofUrl && oldProofUrl !== newProofUrl) {
      await deleteUploadFile(oldProofUrl);
    }

    await logAudit({
      module: 'financial',
      action: 'withdrawal_proof_uploaded',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'withdrawal_request',
      targetId: withdrawal._id,
      message: 'Comprovante de saque anexado',
      metadata: {
        proofUrl: newProofUrl,
      },
    });

    res.json({
      message: 'Comprovante anexado ao saque',
      withdrawal,
    });
  } catch (err) {
    await cleanupRequestUploads(req);
    res.status(500).json({ message: err.message || 'Erro ao anexar comprovante' });
  }
});

// ── FILA DE APROVAÇÃO ─────────────────────────────────────────────
// GET /api/admin/approvals?page=1&limit=20
router.get('/approvals', adminAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  try {
    const users = await User.find({ verificationStatus: 'pending_review' })
      .select('name email phone userType cpf birthDate selfieUrl documentUrl documentBackUrl residenceProofUrl createdAt')
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
      .select('name email phone userType cpf birthDate selfieUrl documentUrl documentBackUrl residenceProofUrl createdAt verificationStatus');
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
    // Push de aprovação
    if (user.pushToken) {
      sendExpoPush(user.pushToken, '✅ Conta aprovada!', 'Sua conta foi aprovada. Bem-vindo ao Já! Você já pode começar a atender.', { screen: 'Dashboard' });
    }
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
    // Push de rejeição
    if (user.pushToken) {
      sendExpoPush(user.pushToken, '⚠️ Verificação recusada', 'Sua documentação foi recusada. Acesse o app para ver o motivo e reenviar.', { screen: 'PendingApproval' });
    }
    res.json({ message: 'Usuário rejeitado', user });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao rejeitar usuário' });
  }
});

// ── ESPECIALISTAS ─────────────────────────────────────────────────
// GET /api/admin/specialist-certificates?status=pending
router.get('/specialist-certificates', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const certs = await SpecialistCertificate.find(filter)
      .populate('professional', 'name email phone professional.rating professional.totalServicesCompleted professional.specializations professional.isSpecialist')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });
    res.json({ certificates: certs });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar certificados' });
  }
});

// PATCH /api/admin/specialist-certificates/:id/approve
// Body: { adminNote: "Especialista em Limpeza de Piscinas" }
router.patch('/specialist-certificates/:id/approve', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const { adminNote } = req.body;
    if (!adminNote || !adminNote.trim()) {
      return res.status(400).json({ message: 'Informe o título de especialização que será exibido ao cliente.' });
    }

    const cert = await SpecialistCertificate.findById(req.params.id).populate('professional');
    if (!cert) return res.status(404).json({ message: 'Certificado não encontrado.' });

    cert.status = 'approved';
    cert.adminNote = adminNote.trim();
    cert.reviewedAt = new Date();
    cert.reviewedBy = req.admin._id;
    await cert.save();

    // Adicionar especialização ao perfil do profissional e marcar como especialista
    await User.findByIdAndUpdate(cert.professional._id, {
      $set: { 'professional.isSpecialist': true },
      $push: {
        'professional.specializations': {
          title: adminNote.trim(),
          certificateId: cert._id,
          grantedAt: new Date(),
        },
      },
    });

    await logAudit({
      module: 'financial',
      action: 'specialist_certificate_approved',
      severity: 'medium',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'user',
      targetId: cert.professional._id,
      message: `Certificado aprovado: "${adminNote.trim()}"`,
      metadata: { certificateId: cert._id, professionalId: cert.professional._id },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${cert.professional._id}`).emit('specialist_certificate_approved', {
        certificateId: cert._id,
        title: adminNote.trim(),
      });
    }

    res.json({ message: 'Certificado aprovado. Profissional agora é Especialista.', certificate: cert });
  } catch (err) {
    console.error('Erro ao aprovar certificado:', err);
    res.status(500).json({ message: 'Erro ao aprovar certificado.' });
  }
});

// PATCH /api/admin/specialist-certificates/:id/reject
router.patch('/specialist-certificates/:id/reject', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Informe o motivo da rejeição.' });
    }

    const cert = await SpecialistCertificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ message: 'Certificado não encontrado.' });

    cert.status = 'rejected';
    cert.rejectionReason = reason.trim();
    cert.reviewedAt = new Date();
    cert.reviewedBy = req.admin._id;
    await cert.save();

    await logAudit({
      module: 'financial',
      action: 'specialist_certificate_rejected',
      severity: 'low',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'user',
      targetId: cert.professional,
      message: `Certificado rejeitado: "${reason.trim()}"`,
      metadata: { certificateId: cert._id },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${cert.professional}`).emit('specialist_certificate_rejected', {
        certificateId: cert._id,
        reason: reason.trim(),
      });
    }

    res.json({ message: 'Certificado rejeitado.', certificate: cert });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao rejeitar certificado.' });
  }
});

// ── USUÁRIOS ──────────────────────────────────────────────────────
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
router.get('/admins', adminAuth, requirePermission(ADMIN_PERMISSIONS.ACCESS_MANAGEMENT), async (req, res) => {
  const admins = await AdminUser.find().select('-password').sort({ createdAt: -1 });
  res.json(admins.map(withEffectivePermissions));
});

router.get('/access/permissions', adminAuth, requirePermission(ADMIN_PERMISSIONS.ACCESS_MANAGEMENT), async (req, res) => {
  const rolePresets = {
    support: getRolePermissionPreset('support'),
    admin: getRolePermissionPreset('admin'),
    super_admin: ['*'],
  };
  res.json({
    permissions: permissionCatalog,
    allPermissionKeys: ALL_PERMISSION_VALUES,
    rolePresets,
  });
});

// POST /api/admin/admins
router.post('/admins', adminAuth, requirePermission(ADMIN_PERMISSIONS.ACCESS_MANAGEMENT), async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    permissions,
    applyRolePreset,
    supportRole,
    supportSupervisor,
  } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Campos obrigatórios faltando' });
  try {
    const existing = await AdminUser.findOne({ email });
    if (existing) return res.status(400).json({ message: 'E-mail já cadastrado' });
    const finalRole = role || 'support';
    const finalSupportRole = finalRole === 'support'
      ? (supportRole === 'supervisor' ? 'supervisor' : 'operator')
      : 'operator';

    let supervisorId = null;
    if (finalRole === 'support' && finalSupportRole === 'operator') {
      if (!supportSupervisor) {
        return res.status(400).json({ message: 'Operador deve ser vinculado a um supervisor' });
      }
      const supervisor = await AdminUser.findOne({
        _id: supportSupervisor,
        role: 'support',
        supportRole: 'supervisor',
        isActive: true,
      });
      if (!supervisor) {
        return res.status(400).json({ message: 'Supervisor informado é inválido' });
      }
      supervisorId = supervisor._id;
    }

    const resolvedPermissions = resolvePermissionsForRole({
      role: finalRole,
      permissions,
      applyRolePreset: applyRolePreset === true,
    });
    const admin = await AdminUser.create({
      name,
      email,
      password,
      role: finalRole,
      supportRole: finalSupportRole,
      supportSupervisor: supervisorId,
      permissions: resolvedPermissions,
    });
    await logAudit({
      module: 'access',
      action: 'admin_created',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'admin_user',
      targetId: admin._id,
      message: `Admin ${admin.email} criado com role ${admin.role}`,
      metadata: {
        role: admin.role,
        supportRole: admin.supportRole,
        supportSupervisor: admin.supportSupervisor || null,
        permissions: sanitizePermissions(admin.permissions),
        presetApplied: applyRolePreset === true || (sanitizePermissions(permissions).length === 0),
      },
    });
    res.status(201).json({ message: 'Admin criado', admin: withEffectivePermissions(admin) });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao criar admin' });
  }
});

router.patch('/admins/:id/access', adminAuth, requirePermission(ADMIN_PERMISSIONS.ACCESS_MANAGEMENT), async (req, res) => {
  try {
    const { role, isActive, permissions, applyRolePreset, supportRole, supportSupervisor } = req.body;
    const admin = await AdminUser.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin não encontrado' });

    let nextRole = admin.role;
    if (role && ['super_admin', 'admin', 'support'].includes(role)) {
      admin.role = role;
      nextRole = role;
    }
    if (typeof isActive === 'boolean') {
      if (req.params.id === req.admin._id.toString() && !isActive) {
        return res.status(400).json({ message: 'Você não pode desativar sua própria conta' });
      }
      admin.isActive = isActive;
    }
    if (nextRole === 'support') {
      if (supportRole === 'supervisor' || supportRole === 'operator') {
        admin.supportRole = supportRole;
      } else if (!admin.supportRole) {
        admin.supportRole = 'operator';
      }

      if (admin.supportRole === 'operator') {
        const supervisorIdCandidate = supportSupervisor !== undefined ? supportSupervisor : admin.supportSupervisor;
        if (!supervisorIdCandidate) {
          return res.status(400).json({ message: 'Operador deve ter supervisor vinculado' });
        }
        const supervisor = await AdminUser.findOne({
          _id: supervisorIdCandidate,
          role: 'support',
          supportRole: 'supervisor',
          isActive: true,
        });
        if (!supervisor) {
          return res.status(400).json({ message: 'Supervisor informado é inválido' });
        }
        admin.supportSupervisor = supervisor._id;
      } else {
        admin.supportSupervisor = null;
      }
    } else {
      admin.supportSupervisor = null;
    }

    if (permissions !== undefined || applyRolePreset === true || role) {
      admin.permissions = resolvePermissionsForRole({
        role: nextRole,
        permissions,
        applyRolePreset: applyRolePreset === true || permissions === undefined,
      });
    }

    await admin.save();
    await logAudit({
      module: 'access',
      action: 'admin_access_updated',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'admin_user',
      targetId: admin._id,
      message: `Acesso do admin ${admin.email} atualizado`,
      metadata: {
        role: admin.role,
        supportRole: admin.supportRole,
        supportSupervisor: admin.supportSupervisor || null,
        isActive: admin.isActive,
        permissions: sanitizePermissions(admin.permissions),
      },
    });
    res.json({ message: 'Acesso atualizado', admin: withEffectivePermissions(admin) });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar acesso do admin' });
  }
});

// DELETE /api/admin/admins/:id
router.delete('/admins/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.ACCESS_MANAGEMENT), async (req, res) => {
  if (req.params.id === req.admin._id.toString()) {
    return res.status(400).json({ message: 'Não é possível remover a si mesmo' });
  }
  const toDelete = await AdminUser.findById(req.params.id);
  await AdminUser.findByIdAndDelete(req.params.id);
  await logAudit({
    module: 'access',
    action: 'admin_deleted',
    actorType: 'admin',
    actorAdminId: req.admin._id,
    targetType: 'admin_user',
    targetId: req.params.id,
    severity: 'high',
    message: `Admin removido: ${toDelete?.email || req.params.id}`,
  });
  res.json({ message: 'Admin removido' });
});

// ── SUPORTE / CHAT ────────────────────────────────────────────────
// GET /api/admin/chats?status=open
router.get('/chats', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.get('/chats/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.post('/chats/:id/message', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.patch('/chats/:id/close', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.patch('/support/toggle-status', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
        const next = await SupportChat.findOne({ status: 'waiting' }).sort({ priorityLevel: -1, queuedAt: 1 });
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
router.get('/support/status', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const admin = await AdminUser.findById(req.admin._id).select('supportStatus onlineAt activeSupportChats');
    const waitingCount = await SupportChat.countDocuments({ status: 'waiting' });
    const waitingP1Count = await SupportChat.countDocuments({ status: 'waiting', priority: 'p1' });
    res.json({ ...admin.toObject(), waitingCount, waitingP1Count });
  } catch {
    res.status(500).json({ message: 'Erro' });
  }
});

// GET /api/admin/support/queue — fila de espera global
router.get('/support/queue', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const chats = await SupportChat.find({ status: 'waiting' })
      .populate('userId', 'name email avatar')
      .sort({ priorityLevel: -1, queuedAt: 1 })
      .limit(50);
    res.json({ queue: chats });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar fila' });
  }
});

// GET /api/admin/support/my-chats — chats atribuídos ao operador logado
router.get('/support/my-chats', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const chats = await SupportChat.find({
      assignedTo: req.admin._id,
      status: 'assigned',
    }).populate('userId', 'name email avatar').sort({ priorityLevel: -1, assignedAt: -1 });
    res.json({ chats });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar meus chats' });
  }
});

// GET /api/admin/support/chats/:id — detalhes de um chat
router.get('/support/chats/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.post('/support/chats/:id/message', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.patch('/support/chats/:id/close', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
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
router.get('/support/operators', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const operators = await AdminUser.find({
      role: 'support',
      supportRole: 'operator',
      supportStatus: 'online',
      isActive: true,
    })
      .select('name role supportRole activeSupportChats onlineAt')
      .sort({ activeSupportChats: 1, onlineAt: 1 });
    res.json({ operators });
  } catch {
    res.status(500).json({ message: 'Erro' });
  }
});

// GET /api/admin/service-chats — auditoria de chats entre cliente e profissional
router.get('/service-chats', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const { status = 'all' } = req.query;
    const query = status === 'all' ? {} : { status };
    const chats = await ServiceChat.find(query)
      .populate('requestId', 'status createdAt completedAt cancelReason')
      .populate('clientId', 'name email')
      .populate('professionalId', 'name email')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(100);
    res.json({ chats });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chats de serviço' });
  }
});

// GET /api/admin/service-chats/:id — detalhe de um chat de serviço
router.get('/service-chats/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const chat = await ServiceChat.findById(req.params.id)
      .populate('requestId', 'status createdAt completedAt cancelReason address details pricing')
      .populate('clientId', 'name email phone')
      .populate('professionalId', 'name email phone');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    res.json({ chat });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chat de serviço' });
  }
});

// GET /api/admin/support/requests/search?q=...&status=...
router.get('/support/requests/search', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
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

      const safeRegex = new RegExp(escapeRegex(q), 'i');
      const users = await User.find({
        $or: [
          { name: safeRegex },
          { email: safeRegex },
          { phone: safeRegex },
        ],
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

    const items = requests.map((request) => ({
      ...request.toObject(),
      supportActions: {
        canCancel: ['searching', 'accepted', 'in_progress'].includes(request.status),
        canRefund: request?.payment?.status === 'paid',
      },
    }));

    res.json({ items });
  } catch (err) {
    console.error('Support request search error:', err);
    res.status(500).json({ message: 'Erro ao buscar serviços contratados' });
  }
});

// PATCH /api/admin/support/requests/:id/cancel
router.patch('/support/requests/:id/cancel', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const request = await ServiceRequest.findById(req.params.id)
      .populate('client', 'name')
      .populate('professional', 'name');
    if (!request) return res.status(404).json({ message: 'Serviço não encontrado' });

    if (request.status === 'cancelled') {
      return res.status(400).json({ message: 'Serviço já está cancelado' });
    }
    if (request.status === 'completed') {
      return res.status(400).json({ message: 'Serviço já foi concluído e não pode ser cancelado' });
    }

    if (request.status === 'searching') {
      clearRequestTimer(request._id);
      request.currentAssignedTo = null;
    }

    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.cancelReason = reason || `Cancelado pelo suporte (${req.admin.name})`;
    await request.save();

    await logAudit({
      module: 'support',
      action: 'support_request_cancelled',
      severity: 'high',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'service_request',
      targetId: request._id,
      message: `Serviço cancelado pelo suporte por ${req.admin.name}`,
      metadata: {
        reason: request.cancelReason,
        paymentStatus: request?.payment?.status || null,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client._id}`).emit('request_cancelled_by_support', {
        requestId: request._id,
        reason: request.cancelReason,
      });
      if (request.professional?._id) {
        io.to(`user_${request.professional._id}`).emit('request_cancelled_by_support', {
          requestId: request._id,
          reason: request.cancelReason,
        });
      }
    }

    res.json({ message: 'Serviço cancelado com sucesso', request });
  } catch (err) {
    console.error('Support cancel request error:', err);
    res.status(500).json({ message: 'Erro ao cancelar serviço' });
  }
});

// PATCH /api/admin/support/requests/:id/refund
router.patch('/support/requests/:id/refund', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const destination = String(req.body.destination || 'gateway').trim().toLowerCase();
    const useWalletRefund = destination === 'wallet';
    const request = await ServiceRequest.findById(req.params.id)
      .populate('client', 'name wallet clientWallet')
      .populate('professional', 'name');
    if (!request) return res.status(404).json({ message: 'Serviço não encontrado' });

    if (request?.payment?.status !== 'paid') {
      return res.status(400).json({ message: 'Somente serviços pagos podem ter estorno solicitado' });
    }

    const tx = String(request?.payment?.transactionId || '');
    const method = String(request?.payment?.method || '').toLowerCase();
    const refundAmount = Number(request?.pricing?.customerTotal || request?.pricing?.estimated || 0);

    if (useWalletRefund) {
      // Estornar para carteira do cliente
      const client = await User.findById(request.client._id);
      if (!client) return res.status(404).json({ message: 'Cliente não encontrado' });

      client.clientWallet = client.clientWallet || { balance: 0, totalRefunded: 0 };
      client.clientWallet.balance = Number((Number(client.clientWallet.balance || 0) + refundAmount).toFixed(2));
      client.clientWallet.totalRefunded = Number((Number(client.clientWallet.totalRefunded || 0) + refundAmount).toFixed(2));
      await client.save();

      const ClientWalletTransaction = require('../models/ClientWalletTransaction');
      await ClientWalletTransaction.create({
        user: client._id,
        serviceRequest: request._id,
        type: 'credit_refund',
        source: 'support_refund_wallet',
        amount: refundAmount,
        balanceAfterClientWallet: client.clientWallet.balance,
        metadata: {
          label: `Estorno para carteira por ${req.admin.name}`,
          reason: reason || 'Estorno administrativo',
        },
      });

      request.payment.status = 'refunded';
      request.payment.refundedAt = new Date();
      request.payment.refundReason = reason || `Estorno para carteira por ${req.admin.name}`;
      request.payment.refundReference = `wallet:${client._id}:${Date.now()}`;
      request.payment.refundDestination = 'wallet';
      await request.save();

      await logAudit({
        module: 'financial',
        action: 'support_refund_wallet',
        severity: 'high',
        actorType: 'admin',
        actorAdminId: req.admin._id,
        targetType: 'service_request',
        targetId: request._id,
        message: 'Estorno creditado na carteira do cliente',
        metadata: { amount: refundAmount, clientId: client._id },
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${request.client._id}`).emit('request_refunded_by_support', {
          requestId: request._id,
          destination: 'wallet',
          amount: refundAmount,
        });
      }

      return res.json({
        message: `R$ ${refundAmount.toFixed(2)} creditado na carteira do cliente`,
        request,
        refundDestination: 'wallet',
        walletNewBalance: client.clientWallet.balance,
      });
    }

    if (tx.startsWith('cora:') || method === 'pix') {
      request.payment.refundRequestedAt = new Date();
      request.payment.refundReason = reason || `Solicitado via suporte por ${req.admin.name}`;
      await request.save();
      await logAudit({
        module: 'financial',
        action: 'support_refund_requested_manual',
        severity: 'high',
        actorType: 'admin',
        actorAdminId: req.admin._id,
        targetType: 'service_request',
        targetId: request._id,
        message: 'Estorno PIX/Cora solicitado para análise manual',
        metadata: {
          transactionId: tx,
          method,
          reason: request.payment.refundReason,
        },
      });
      return res.json({
        message: 'Solicitação de estorno registrada para análise financeira (PIX/Cora)',
        request,
        pendingManualReview: true,
      });
    }

    if (tx.startsWith('wallet:')) {
      // Devolve para carteira se foi pago integralmente por carteira
      const client = await User.findById(request.client._id);
      if (!client) return res.status(404).json({ message: 'Cliente não encontrado' });

      client.clientWallet = client.clientWallet || { balance: 0, totalRefunded: 0 };
      client.clientWallet.balance = Number((Number(client.clientWallet.balance || 0) + refundAmount).toFixed(2));
      client.clientWallet.totalRefunded = Number((Number(client.clientWallet.totalRefunded || 0) + refundAmount).toFixed(2));
      await client.save();

      const ClientWalletTransaction = require('../models/ClientWalletTransaction');
      await ClientWalletTransaction.create({
        user: client._id,
        serviceRequest: request._id,
        type: 'credit_refund',
        source: 'support_refund_wallet',
        amount: refundAmount,
        balanceAfterClientWallet: client.clientWallet.balance,
        metadata: { label: 'Estorno de pagamento via carteira', reason },
      });

      request.payment.status = 'refunded';
      request.payment.refundedAt = new Date();
      request.payment.refundReason = reason || `Estorno de carteira por ${req.admin.name}`;
      request.payment.refundDestination = 'wallet';
      await request.save();

      return res.json({ message: 'Estorno creditado na carteira', request, refundDestination: 'wallet' });
    }

    if (!tx) {
      return res.status(400).json({ message: 'Transação inválida para estorno' });
    }

    // Aceita apenas IDs válidos do Stripe para estorno automático.
    // Evita enviar identificadores internos (wallet:, cora:, service:, etc.) para a API do Stripe.
    const isStripePaymentIntent = tx.startsWith('pi_');
    const isStripeCharge = tx.startsWith('ch_');
    if (!isStripePaymentIntent && !isStripeCharge) {
      return res.status(400).json({
        message: 'Transação não suportada para estorno automático no Stripe. Use estorno em carteira ou fluxo manual.',
      });
    }

    const stripe = await getStripeClientForAdmin();
    const refundPayload = isStripePaymentIntent
      ? { payment_intent: tx }
      : { charge: tx };
    const refund = await stripe.refunds.create(refundPayload);

    request.payment.status = 'refunded';
    request.payment.refundedAt = new Date();
    request.payment.refundReason = reason || `Estorno efetuado via suporte por ${req.admin.name}`;
    request.payment.refundReference = refund.id;
    request.payment.refundDestination = 'gateway';
    await request.save();

    await logAudit({
      module: 'financial',
      action: 'support_refund_processed',
      severity: 'high',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      targetType: 'service_request',
      targetId: request._id,
      message: 'Estorno processado automaticamente no Stripe',
      metadata: {
        refundId: refund.id,
        transactionId: tx,
        method,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.client._id}`).emit('request_refunded_by_support', {
        requestId: request._id,
        refundId: refund.id,
        destination: 'gateway',
      });
    }

    res.json({ message: 'Estorno processado com sucesso', request, refundId: refund.id });
  } catch (err) {
    console.error('Support refund request error:', err);
    const detail = err?.raw?.message || err.message || 'Erro ao processar estorno';
    res.status(500).json({ message: detail });
  }
});

router.get('/audit-logs', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.ACCESS_MANAGEMENT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const query = await buildAuditQuery(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));

    const logs = await AuditLog.find(query)
      .populate('actorAdminId', 'name email role')
      .populate('actorUserId', 'name email userType')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ logs });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar auditoria' });
  }
});

router.get('/audit-logs/export.csv', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT, ADMIN_PERMISSIONS.ACCESS_MANAGEMENT, ADMIN_PERMISSIONS.FINANCIAL), async (req, res) => {
  try {
    const query = await buildAuditQuery(req);
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
    const logs = await AuditLog.find(query)
      .populate('actorAdminId', 'name email role')
      .populate('actorUserId', 'name email userType')
      .sort({ createdAt: -1 })
      .limit(limit);

    const header = [
      'createdAt',
      'module',
      'action',
      'severity',
      'actorType',
      'actorName',
      'actorEmail',
      'targetType',
      'targetId',
      'message',
      'metadata',
    ];
    const rows = logs.map((log) => {
      const actorName = log.actorAdminId?.name || log.actorUserId?.name || '';
      const actorEmail = log.actorAdminId?.email || log.actorUserId?.email || '';
      return [
        new Date(log.createdAt).toISOString(),
        log.module,
        log.action,
        log.severity,
        log.actorType,
        actorName,
        actorEmail,
        log.targetType || '',
        log.targetId || '',
        log.message || '',
        JSON.stringify(log.metadata || {}),
      ].map(csvCell).join(',');
    });
    const csv = [header.map(csvCell).join(','), ...rows].join('\n');

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${stamp}.csv"`);
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao exportar auditoria CSV' });
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

// ── CONFIGURAÇÃO DE PREÇOS — REMOVIDA ────────────────────────────────────────
// Preços agora são gerenciados diretamente em cada Profissão (ServiceType).
// As rotas GET/PATCH /pricing foram removidas intencionalmente.

// ── STRIPE CONFIG ────────────────────────────────────────────────
// GET /api/admin/stripe-config
router.get('/stripe-config', adminAuth, requirePermission(ADMIN_PERMISSIONS.PAYMENT_MANAGEMENT), async (req, res) => {
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
router.patch('/stripe-config', adminAuth, requirePermission(ADMIN_PERMISSIONS.PAYMENT_MANAGEMENT), requireRole('super_admin'), async (req, res) => {
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
    usageScope,
    firstOrderOnly,
    professionalRewardType,
    professionalRewardValue,
    professionalFirstServiceOnly,
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
      usageScope: usageScope || 'checkout',
      firstOrderOnly: !!firstOrderOnly,
      professionalRewardType: professionalRewardType || 'none',
      professionalRewardValue: Number(professionalRewardValue || 0),
      professionalFirstServiceOnly: !!professionalFirstServiceOnly,
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
    if (updates.professionalRewardValue !== undefined) updates.professionalRewardValue = Number(updates.professionalRewardValue || 0);
    if (updates.firstOrderOnly !== undefined) updates.firstOrderOnly = !!updates.firstOrderOnly;
    if (updates.professionalFirstServiceOnly !== undefined) updates.professionalFirstServiceOnly = !!updates.professionalFirstServiceOnly;

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

// ─── Pause Types ───────────────────────────────────────────────────────────

const PauseType = require('../models/PauseType');

const normalizeBasicText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

const normalizeCompactText = (value = '') => normalizeBasicText(value).replace(/[^a-z0-9]/g, '');

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

const normalizeStateKey = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const basic = normalizeBasicText(raw);
  const compact = normalizeCompactText(raw);
  if (/^[a-z]{2}$/.test(compact) && BRAZIL_STATES[compact]) return compact;
  if (BRAZIL_STATE_NAME_TO_UF[compact]) return BRAZIL_STATE_NAME_TO_UF[compact];
  return basic;
};

// ─── Cities Coverage ───────────────────────────────────────────────────────

// GET /api/admin/coverage-cities
router.get('/coverage-cities', adminAuth, requirePermission(ADMIN_PERMISSIONS.SERVICE_MANAGEMENT), async (req, res) => {
  try {
    const cities = await ServiceCoverageCity.find().sort({ order: 1, city: 1, createdAt: 1 });
    res.json({ coverageCities: cities });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar cidades atendidas' });
  }
});

// POST /api/admin/coverage-cities
router.post('/coverage-cities', adminAuth, requirePermission(ADMIN_PERMISSIONS.SERVICE_MANAGEMENT), async (req, res) => {
  try {
    const { city, state, isActive, order } = req.body;
    const cityName = String(city || '').trim();
    const stateName = String(state || '').trim();
    if (!cityName) {
      return res.status(400).json({ message: 'Cidade é obrigatória' });
    }

    const normalizedCity = normalizeCityKey(cityName);
    const normalizedState = normalizeStateKey(stateName);
    const coverageCity = await ServiceCoverageCity.create({
      city: cityName,
      state: stateName,
      normalizedCity,
      normalizedState,
      isActive: isActive !== false,
      order: Number(order || 0),
    });
    res.status(201).json({ coverageCity });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Essa cidade já está cadastrada' });
    }
    res.status(500).json({ message: 'Erro ao criar cidade atendida' });
  }
});

// POST /api/admin/coverage-cities/bulk
router.post('/coverage-cities/bulk', adminAuth, requirePermission(ADMIN_PERMISSIONS.SERVICE_MANAGEMENT), async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'Envie uma lista de cidades para importar' });
    }

    const created = [];
    const skipped = [];
    const invalid = [];

    for (let i = 0; i < entries.length; i += 1) {
      const raw = entries[i] || {};
      const cityName = String(raw.city || '').trim();
      const stateName = String(raw.state || '').trim();
      const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : i;
      const isActive = raw.isActive !== false;

      if (!cityName) {
        invalid.push({ index: i, reason: 'Cidade vazia' });
        continue;
      }

      const normalizedCity = normalizeCityKey(cityName);
      const normalizedState = normalizeStateKey(stateName);
      if (!normalizedCity) {
        invalid.push({ index: i, city: cityName, reason: 'Cidade inválida' });
        continue;
      }

      const existing = await ServiceCoverageCity.findOne({ normalizedCity, normalizedState });
      if (existing) {
        skipped.push({
          index: i,
          city: existing.city,
          state: existing.state || '',
          reason: 'Já cadastrada',
        });
        continue;
      }

      const newCity = await ServiceCoverageCity.create({
        city: cityName,
        state: stateName,
        normalizedCity,
        normalizedState,
        isActive,
        order,
      });
      created.push(newCity);
    }

    res.json({
      message: 'Importação concluída',
      summary: {
        total: entries.length,
        created: created.length,
        skipped: skipped.length,
        invalid: invalid.length,
      },
      created,
      skipped,
      invalid,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Conflito de cidades duplicadas durante a importação' });
    }
    res.status(500).json({ message: 'Erro ao importar cidades atendidas' });
  }
});

// PATCH /api/admin/coverage-cities/:id
router.patch('/coverage-cities/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SERVICE_MANAGEMENT), async (req, res) => {
  try {
    const coverageCity = await ServiceCoverageCity.findById(req.params.id);
    if (!coverageCity) return res.status(404).json({ message: 'Cidade atendida não encontrada' });

    const { city, state, isActive, order } = req.body;
    if (city !== undefined) {
      const cityName = String(city || '').trim();
      if (!cityName) return res.status(400).json({ message: 'Cidade é obrigatória' });
      coverageCity.city = cityName;
      coverageCity.normalizedCity = normalizeCityKey(cityName);
    }
    if (state !== undefined) {
      const stateName = String(state || '').trim();
      coverageCity.state = stateName;
      coverageCity.normalizedState = normalizeStateKey(stateName);
    }
    if (isActive !== undefined) coverageCity.isActive = Boolean(isActive);
    if (order !== undefined) coverageCity.order = Number(order);
    await coverageCity.save();
    res.json({ coverageCity });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Essa combinação de cidade/estado já existe' });
    }
    res.status(500).json({ message: 'Erro ao atualizar cidade atendida' });
  }
});

// DELETE /api/admin/coverage-cities/:id
router.delete('/coverage-cities/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SERVICE_MANAGEMENT), async (req, res) => {
  try {
    const coverageCity = await ServiceCoverageCity.findByIdAndDelete(req.params.id);
    if (!coverageCity) return res.status(404).json({ message: 'Cidade atendida não encontrada' });
    res.json({ message: 'Cidade atendida excluída' });
  } catch {
    res.status(500).json({ message: 'Erro ao excluir cidade atendida' });
  }
});

// GET /api/admin/pause-types
router.get('/pause-types', adminAuth, async (req, res) => {
  try {
    const types = await PauseType.find().sort({ order: 1, createdAt: 1 });
    res.json({ pauseTypes: types });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar tipos de pausa' });
  }
});

// POST /api/admin/pause-types
router.post('/pause-types', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const { name, durationMinutes, isActive, order } = req.body;
    if (!name || !durationMinutes) {
      return res.status(400).json({ message: 'Nome e duração são obrigatórios' });
    }
    const pt = await PauseType.create({
      name: String(name).trim(),
      durationMinutes: Math.max(1, Math.min(480, Number(durationMinutes))),
      isActive: isActive !== false,
      order: Number(order || 0),
    });
    res.status(201).json({ pauseType: pt });
  } catch {
    res.status(500).json({ message: 'Erro ao criar tipo de pausa' });
  }
});

// PATCH /api/admin/pause-types/:id
router.patch('/pause-types/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const { name, durationMinutes, isActive, order } = req.body;
    const pt = await PauseType.findById(req.params.id);
    if (!pt) return res.status(404).json({ message: 'Tipo de pausa não encontrado' });
    if (name !== undefined) pt.name = String(name).trim();
    if (durationMinutes !== undefined) pt.durationMinutes = Math.max(1, Math.min(480, Number(durationMinutes)));
    if (isActive !== undefined) pt.isActive = Boolean(isActive);
    if (order !== undefined) pt.order = Number(order);
    await pt.save();
    res.json({ pauseType: pt });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar tipo de pausa' });
  }
});

// DELETE /api/admin/pause-types/:id
router.delete('/pause-types/:id', adminAuth, requirePermission(ADMIN_PERMISSIONS.SUPPORT_CHAT), async (req, res) => {
  try {
    const pt = await PauseType.findByIdAndDelete(req.params.id);
    if (!pt) return res.status(404).json({ message: 'Tipo de pausa não encontrado' });
    res.json({ message: 'Tipo de pausa excluído' });
  } catch {
    res.status(500).json({ message: 'Erro ao excluir tipo de pausa' });
  }
});

// ── Waitlist da Landing Page ──
router.get('/waitlist', adminAuth, async (req, res) => {
  try {
    const entries = await Waitlist.find().sort({ createdAt: -1 });
    res.json({ total: entries.length, entries });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar waitlist' });
  }
});

router.delete('/waitlist/:id', adminAuth, async (req, res) => {
  try {
    await Waitlist.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'Erro ao excluir entrada' });
  }
});

// ── PUSH CAMPAIGNS ───────────────────────────────────────────────
// GET /api/admin/push-stats — diagnóstico de tokens registrados
router.get('/push-stats', adminAuth, requirePermission(ADMIN_PERMISSIONS.USER_MANAGEMENT), async (req, res) => {
  try {
    const [total, withToken, clients, professionals] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ pushToken: { $ne: null, $exists: true, $type: 'string' } }),
      User.countDocuments({ userType: 'client', pushToken: { $ne: null, $exists: true, $type: 'string' } }),
      User.countDocuments({ userType: 'professional', pushToken: { $ne: null, $exists: true, $type: 'string' } }),
    ]);
    res.json({ total, withToken, clients, professionals });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
});

// POST /api/admin/push-campaign — envia notificação em massa
router.post('/push-campaign', adminAuth, requirePermission(ADMIN_PERMISSIONS.USER_MANAGEMENT), async (req, res) => {
  const { title, body, audience, data: extraData } = req.body;

  if (!title || !body) {
    return res.status(400).json({ message: 'Título e mensagem são obrigatórios.' });
  }
  if (!['all', 'clients', 'professionals'].includes(audience)) {
    return res.status(400).json({ message: 'Público inválido. Use: all | clients | professionals' });
  }

  try {
    // Monta filtro de audiência
    // Usa $ne: false em vez de == true para incluir usuários com isActive:null (registros antigos)
    const filter = {
      pushToken: { $ne: null, $exists: true, $type: 'string' },
      isActive: { $ne: false },
    };
    if (audience === 'clients') {
      filter.userType = 'client';
    } else if (audience === 'professionals') {
      filter.userType = 'professional';
      filter.verificationStatus = 'approved';
    }

    const users = await User.find(filter).select('pushToken').lean();
    const tokens = users.map((u) => u.pushToken).filter(Boolean);

    if (tokens.length === 0) {
      return res.json({ sent: 0, message: 'Nenhum usuário com token de notificação encontrado.' });
    }

    // Envia em lotes de 100 (limite recomendado da Expo Push API)
    const BATCH = 100;
    let sent = 0;
    let errors = 0;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((token) => sendExpoPush(token, title, body, extraData || {})));
      results.forEach((ticket) => {
        if (ticket?.status === 'error') errors++;
        else sent++;
      });
    }

    await logAudit({
      module: 'push',
      action: 'push_campaign_sent',
      actorType: 'admin',
      actorAdminId: req.admin._id,
      severity: 'medium',
      message: `Campanha push enviada → público: ${audience} | destinatários: ${sent} | erros: ${errors} | título: "${title}"`,
    });

    res.json({ sent, errors, audience, title, body });
  } catch (err) {
    console.error('[push-campaign]', err);
    res.status(500).json({ message: 'Erro ao enviar campanha push.' });
  }
});

module.exports = router;

