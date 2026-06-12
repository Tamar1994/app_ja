require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/database');
const initSocket = require('./src/socket');
const logger = require('./src/utils/logger');
const { startReminderScheduler } = require('./src/utils/scheduledReminders');
const { startAutoTransferScheduler } = require('./src/utils/autoTransferJob');

// Sobrescreve console.error/warn/log para que todo o código legado
// também emita JSON estruturado com timestamp no Render
logger.patchConsole();

const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  logger.error('[process] uncaughtException — processo será encerrado', { err: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[process] unhandledRejection', { err: reason instanceof Error ? reason.message : String(reason) });
});

connectDB().then(() => {
  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io);

  server.listen(PORT, () => {
    logger.info(`[server] Servidor Já! rodando na porta ${PORT}`, { env: process.env.NODE_ENV || 'development' });

    // ── Diagnóstico Asaas ─────────────────────────────────────────────────────
    const asaas = require('./src/services/asaasService');
    const mode = asaas.getMode();
    const key  = asaas.getApiKey() || '';
    if (!key) {
      logger.warn(`[asaas] AVISO: ASAAS_API_KEY_${mode === 'production' ? 'PROD' : 'SANDBOX'} não está configurada no Render → pagamentos vão falhar`);
    } else {
      logger.info(`[asaas] Modo: ${mode} | Chave: ${key.slice(0, 14)}... (OK)`);
    }
  });

  // Inicia o job de lembretes WhatsApp para serviços agendados
  startReminderScheduler();

  // Inicia o job de repasse automático para conta Cora (a cada 3h)
  startAutoTransferScheduler();
}).catch((err) => {
  logger.error('[server] Falha crítica ao iniciar servidor', { err: err.message });
  process.exit(1);
});
