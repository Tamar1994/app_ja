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
const paymentRoutes = require('./routes/payments');
const couponRoutes = require('./routes/coupons');
const TermsOfUse = require('./models/TermsOfUse');

const app = express();

app.use(cors());

// Webhook Stripe precisa de raw body ANTES do express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
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
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);

// Termos de uso — público
app.get('/api/terms', async (req, res) => {
  try {
    const terms = await TermsOfUse.getSingleton();
    res.json({ content: terms.content, updatedAt: terms.updatedAt });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar termos de uso' });
  }
});

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
