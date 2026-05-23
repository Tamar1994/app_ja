const mongoose = require('mongoose');
const dns = require('dns');

// Fix para Node.js v17+ no Windows: forçar IPv4 no resolver DNS
dns.setDefaultResultOrder('ipv4first');

const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      family: 4, // IPv4 only — evita ECONNREFUSED em querySrv no Node.js v22+
    });
    logger.info('[db] MongoDB conectado com sucesso');

    mongoose.connection.on('disconnected', () => logger.warn('[db] MongoDB desconectado'));
    mongoose.connection.on('reconnected', () => logger.info('[db] MongoDB reconectado'));
    mongoose.connection.on('error', (err) => logger.error('[db] Erro de conexão MongoDB', { err: err.message }));
  } catch (error) {
    logger.error('[db] Falha ao conectar MongoDB', { err: error.message });
    throw error;
  }
};

module.exports = connectDB;
