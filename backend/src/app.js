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
const supportSystemRoutes = require('./routes/supportSystem');
const serviceChatRoutes = require('./routes/serviceChats');
const paymentRoutes = require('./routes/payments');
const couponRoutes = require('./routes/coupons');
const specialistCertificatesRoutes = require('./routes/specialistCertificates');
const bannerRoutes = require('./routes/banners');
const TermsOfUse = require('./models/TermsOfUse');
const Waitlist = require('./models/Waitlist');

const app = express();

app.use(cors());

// Webhook Stripe precisa de raw body ANTES do express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Servir arquivos de upload
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Servir painel admin
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Servir painel dedicado de suporte
app.use('/suportsystem', express.static(path.join(__dirname, '../suportsystem')));

// Landing Page — raiz do domínio
app.use('/landing', express.static(path.join(__dirname, '../landing')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/index.html'));
});
app.get('/qrcode', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/qrcode.html'));
});

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
app.use('/api/support-system', supportSystemRoutes);
app.use('/api/service-chats', serviceChatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/specialist-certificates', specialistCertificatesRoutes);
app.use('/api/banners', bannerRoutes);

// Termos de uso — público
app.get('/api/terms', async (req, res) => {
  try {
    const terms = await TermsOfUse.getSingleton();
    res.json({ content: terms.content, updatedAt: terms.updatedAt });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar termos de uso' });
  }
});

// Waitlist da Landing Page
app.post('/api/landing/waitlist', express.json(), async (req, res) => {
  const { name, email, source } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'E-mail inválido' });
  }
  try {
    await Waitlist.create({ name: String(name || '').trim(), email, source: source || 'landing' });
  } catch (err) {
    if (err.code === 11000) {
      // E-mail já cadastrado — retorna sucesso mesmo assim (não expõe duplicata)
      return res.json({ ok: true, duplicate: true });
    }
    console.error('[WAITLIST] Erro ao salvar:', err);
    return res.status(500).json({ message: 'Erro ao salvar cadastro' });
  }
  console.log(`[WAITLIST] Novo cadastro: ${name || '?'} | ${email}`);
  res.json({ ok: true });
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
