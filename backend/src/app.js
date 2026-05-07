const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const requestRoutes = require('./routes/requests');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const walletRoutes = require('./routes/wallet');
const serviceTypesRoutes = require('./routes/serviceTypes');
const helpTopicsRoutes = require('./routes/helpTopics');
const supportRoutes = require('./routes/support');

const app = express();

app.use(cors());
app.use(express.json());

// Servir arquivos de upload
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Servir painel admin
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/service-types', serviceTypesRoutes);
app.use('/api/help', helpTopicsRoutes);
app.use('/api/support', supportRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'Já!' });
});

// Handler de erros global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: err.message || 'Erro interno do servidor' });
});

module.exports = app;
