const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');

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

module.exports = { adminAuth, requireRole };
