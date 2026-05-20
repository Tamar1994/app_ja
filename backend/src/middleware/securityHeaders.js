const helmet = require('helmet');

// Helmet já cobre XSS, clickjacking, etc.
module.exports = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});
