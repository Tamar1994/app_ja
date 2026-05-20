const helmet = require('helmet');

// Helmet para rotas de API — CSP estrito (sem inline scripts)
const apiHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// Helmet para o painel admin — permite inline scripts/handlers (painel interno autenticado)
const adminHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
});

module.exports = { apiHeaders, adminHeaders };
