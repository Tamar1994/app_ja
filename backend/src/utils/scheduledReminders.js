/**
 * scheduledReminders.js
 *
 * Job que roda a cada 5 minutos e envia lembretes de WhatsApp
 * para serviços agendados que começam em ~1 hora.
 *
 * Lógica:
 *   - Busca pedidos com status 'scheduled' cujo scheduledDate está
 *     entre (agora + 55min) e (agora + 65min) — janela de 10 min
 *     para garantir que o job de 5/5min não perca o momento.
 *   - Filtra pedidos onde whatsappReminderSentAt ainda não está preenchido.
 *   - Envia WhatsApp para cliente e, se houver profissional aceito, para o profissional.
 *   - Marca whatsappReminderSentAt para não reenviar.
 *
 * IMPORTANTE: no Render free tier o servidor dorme após 15 min de inatividade.
 * Para lembretes confiáveis, use um plano pago ou configure um cron externo
 * (ex: cron-job.org) para fazer ping ao backend a cada 10 min.
 */

'use strict';

const logger            = require('../utils/logger');
const { sendScheduledReminder } = require('../services/whatsappService');

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const WINDOW_BEFORE_MS = 55 * 60 * 1000; // 55 min
const WINDOW_AFTER_MS  = 65 * 60 * 1000; // 65 min

async function runReminderJob() {
  // Lazy-require para evitar problemas de ordem de inicialização
  const ServiceRequest = require('../models/ServiceRequest');
  const ServiceType    = require('../models/ServiceType');

  const now      = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_BEFORE_MS);
  const windowEnd   = new Date(now.getTime() + WINDOW_AFTER_MS);

  try {
    const requests = await ServiceRequest.find({
      requestType: 'scheduled',
      status: { $in: ['scheduled', 'accepted', 'preparing'] },
      'details.scheduledDate': { $gte: windowStart, $lte: windowEnd },
      whatsappReminderSentAt: { $exists: false },
    })
      .populate('client', 'name phone')
      .populate('professional', 'name phone')
      .lean();

    if (!requests.length) return;

    logger.info('[reminders] Processando lembretes de agendamento', { count: requests.length });

    for (const request of requests) {
      // Busca nome amigável do tipo de serviço
      let serviceTypeName = request.serviceTypeSlug || 'Serviço';
      try {
        const st = await ServiceType.findOne({ slug: request.serviceTypeSlug }).select('name').lean();
        if (st?.name) serviceTypeName = st.name;
      } catch { /* ignora */ }

      const scheduledDate = request.details.scheduledDate;

      // Envia para o cliente
      if (request.client?.phone) {
        await sendScheduledReminder(
          request.client.phone,
          request.client.name?.split(' ')[0] || 'Cliente',
          serviceTypeName,
          scheduledDate,
        );
      }

      // Envia para o profissional (se já houver um confirmado)
      if (request.professional?.phone) {
        await sendScheduledReminder(
          request.professional.phone,
          request.professional.name?.split(' ')[0] || 'Profissional',
          serviceTypeName,
          scheduledDate,
        );
      }

      // Marca como enviado (updateOne direto para não disparar hooks desnecessários)
      await ServiceRequest.updateOne(
        { _id: request._id },
        { $set: { whatsappReminderSentAt: new Date() } },
      );

      logger.info('[reminders] Lembrete enviado', {
        requestId: request._id.toString(),
        client: request.client?.name,
        professional: request.professional?.name || 'sem profissional',
        scheduledDate,
      });
    }
  } catch (err) {
    logger.error('[reminders] Erro no job de lembretes', { err: err.message, stack: err.stack });
  }
}

/**
 * Inicia o job de lembretes.
 * Chamar uma vez após a conexão com o banco estar estabelecida.
 */
function startReminderScheduler() {
  logger.info('[reminders] Scheduler de lembretes iniciado (intervalo: 5 min)');

  // Roda uma primeira vez após 30s de warm-up
  setTimeout(runReminderJob, 30_000);

  // Depois a cada 5 minutos
  setInterval(runReminderJob, INTERVAL_MS);
}

module.exports = { startReminderScheduler };
