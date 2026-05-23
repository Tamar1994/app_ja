const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('[auth] Token não fornecido', { path: req.path, ip: req.ip });
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) {
      logger.warn('[auth] Usuário não encontrado ou inativo', { uid: decoded.id, path: req.path });
      return res.status(401).json({ message: 'Usuário não encontrado ou inativo' });
    }
    req.user = user;
    next();
  } catch (err) {
    logger.warn('[auth] Token inválido ou expirado', { path: req.path, err: err.message });
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
};

module.exports = authMiddleware;
