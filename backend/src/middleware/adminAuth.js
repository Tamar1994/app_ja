const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');

const ADMIN_PERMISSIONS = {
  DASHBOARD: 'dashboard_view',
  SUPPORT_CHAT: 'support_chat',
  FINANCIAL: 'financial',
  USER_MANAGEMENT: 'user_management',
  SERVICE_MANAGEMENT: 'service_management',
  CONTENT_MANAGEMENT: 'content_management',
  COUPON_MANAGEMENT: 'coupon_management',
  PAYMENT_MANAGEMENT: 'payment_management',
  ACCESS_MANAGEMENT: 'access_management',
};

const ALL_PERMISSION_VALUES = Object.values(ADMIN_PERMISSIONS);

const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin: [
    ADMIN_PERMISSIONS.DASHBOARD,
    ADMIN_PERMISSIONS.SUPPORT_CHAT,
    ADMIN_PERMISSIONS.FINANCIAL,
    ADMIN_PERMISSIONS.USER_MANAGEMENT,
    ADMIN_PERMISSIONS.SERVICE_MANAGEMENT,
    ADMIN_PERMISSIONS.CONTENT_MANAGEMENT,
    ADMIN_PERMISSIONS.COUPON_MANAGEMENT,
    ADMIN_PERMISSIONS.PAYMENT_MANAGEMENT,
  ],
  support: [
    ADMIN_PERMISSIONS.DASHBOARD,
    ADMIN_PERMISSIONS.SUPPORT_CHAT,
  ],
};

const sanitizePermissions = (permissions) => {
  const input = Array.isArray(permissions) ? permissions : [];
  return [...new Set(input.filter((p) => ALL_PERMISSION_VALUES.includes(p)))];
};

const getEffectivePermissions = (admin) => {
  if (!admin) return [];
  if (admin.role === 'super_admin') return ['*'];
  const custom = sanitizePermissions(admin.permissions);
  if (custom.length > 0) return custom;
  return DEFAULT_ROLE_PERMISSIONS[admin.role] || [];
};

const hasPermission = (admin, permission) => {
  const effective = getEffectivePermissions(admin);
  return effective.includes('*') || effective.includes(permission);
};

const adminAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Não autorizado' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await AdminUser.findById(decoded.id);
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: 'Acesso negado' });
    }
    req.admin = admin;
    req.adminPermissions = getEffectivePermissions(admin);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.admin.role)) {
    return res.status(403).json({ message: 'Permissão insuficiente' });
  }
  next();
};

const requirePermission = (...permissions) => (req, res, next) => {
  const allowed = permissions.some((permission) => hasPermission(req.admin, permission));
  if (!allowed) {
    return res.status(403).json({ message: 'Permissão insuficiente para este módulo' });
  }
  next();
};

module.exports = {
  adminAuth,
  requireRole,
  requirePermission,
  hasPermission,
  getEffectivePermissions,
  sanitizePermissions,
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_VALUES,
};
