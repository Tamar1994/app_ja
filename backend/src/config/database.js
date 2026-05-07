const mongoose = require('mongoose');
const dns = require('dns');

// Fix para Node.js v17+ no Windows: forçar IPv4 no resolver DNS
dns.setDefaultResultOrder('ipv4first');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      family: 4, // IPv4 only — evita ECONNREFUSED em querySrv no Node.js v22+
    });
    console.log('✅ MongoDB conectado');
  } catch (error) {
    console.error('❌ Erro MongoDB:', error.message);
    throw error;
  }
};

module.exports = connectDB;
