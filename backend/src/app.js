const mongoSanitize = require('express-mongo-sanitize');

const express = require('express');
const cors = require('cors');
const { apiLimiter, loginLimiter } = require('./middleware/rateLimit');
const { adminHeaders } = require('./middleware/securityHeaders');
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
const suggestionsRoutes = require('./routes/suggestions');
const notificationsRoutes = require('./routes/notifications');
const TermsOfUse = require('./models/TermsOfUse');
const Waitlist = require('./models/Waitlist');
const RegionInterest = require('./models/RegionInterest');
const AppConfig = require('./models/AppConfig');

const app = express();

// Necessário para que o Express confie no proxy do Render/Heroku/etc.
// Sem isso, o rate limiter vê todos os usuários com o mesmo IP (IP do proxy)
// e o limite de 1000 req/15min é compartilhado por TODOS os usuários juntos.
app.set('trust proxy', 1);

// CORS aberto para API (segurança real é feita via JWT em cada rota)
app.use(cors());

// Rate limiting global
app.use(apiLimiter);

// Webhook Stripe precisa de raw body ANTES do express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Proteção contra NoSQL injection (deve rodar DEPOIS do express.json para ter o body parseado)
app.use(mongoSanitize());

// Servir arquivos de upload
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Servir painel admin (CSP permissivo para inline handlers)
app.use('/admin', adminHeaders, express.static(path.join(__dirname, '../admin')));

// Servir painel dedicado de suporte (CSP permissivo para inline handlers)
app.use('/suportsystem', adminHeaders, express.static(path.join(__dirname, '../suportsystem')));

// Landing Page — raiz do domínio
app.use('/landing', express.static(path.join(__dirname, '../landing')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/index.html'));
});
app.get('/qrcode', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/qrcode.html'));
});
app.get('/politica-de-privacidade', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/politica-de-privacidade.html'));
});
app.get('/excluir-conta', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/excluir-conta.html'));
});
app.get('/excluir-dados', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing/excluir-dados.html'));
});

// Rate limiting específico para login
app.use('/api/auth/login', loginLimiter, authRoutes);
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
app.use('/api/suggest-service', suggestionsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Termos de uso — público
app.get('/api/terms', async (req, res) => {
  try {
    const terms = await TermsOfUse.getSingleton();
    res.json({ content: terms.content, updatedAt: terms.updatedAt });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar termos de uso' });
  }
});

// Solicitação LGPD (exclusão/acesso/correção de dados) — página excluir-dados.html
app.post('/api/lgpd/request', express.json(), async (req, res) => {
  const { nome, email, tipo, descricao } = req.body || {};
  if (!nome || !email || !tipo || !descricao) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'E-mail inválido.' });
  }
  console.log(`[LGPD] Nova solicitação — tipo: ${tipo} | email: ${email} | nome: ${nome}`);
  // Registra a solicitação em log. Uma integração de e-mail ou ticket
  // pode ser adicionada aqui conforme necessário.
  res.json({ ok: true });
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
  res.json({ ok: true });
});

// Interesse de cobertura regional — salva cidades não atendidas para comunicações futuras
app.post('/api/coverage/interest', express.json(), async (req, res) => {
  const { city, state, coordinates, email } = req.body || {};
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanCity  = String(city  || '').trim();
  const cleanState = String(state || '').trim();
  const cleanCoords = Array.isArray(coordinates) ? coordinates : null;

  try {
    if (cleanEmail && cleanEmail.includes('@')) {
      // Upsert: se o e-mail já existe, atualiza a cidade; se não, cria
      await RegionInterest.findOneAndUpdate(
        { email: cleanEmail },
        { $set: { city: cleanCity, state: cleanState, coordinates: cleanCoords, source: 'app' } },
        { upsert: true, new: true }
      );
    } else {
      // Sem e-mail: registra anonimamente para contar demanda por cidade
      await RegionInterest.create({
        city: cleanCity,
        state: cleanState,
        coordinates: cleanCoords,
        source: 'app',
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[COVERAGE INTEREST]', err.message);
    res.status(500).json({ message: 'Erro ao registrar interesse' });
  }
});

// Configuração de cadastros — público (lido pelo app na tela de registro)
app.get('/api/app-config', async (req, res) => {
  try {
    const config = await AppConfig.getSingleton();
    res.json({
      allowClientRegistration:       config.allowClientRegistration,
      allowProfessionalRegistration: config.allowProfessionalRegistration,
    });
  } catch {
    // Fallback seguro: libera ambos os tipos caso o banco esteja indisponível
    res.json({ allowClientRegistration: true, allowProfessionalRegistration: true });
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
