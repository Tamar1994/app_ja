'use strict';

/**
 * autoTransferJob.js
 *
 * Job que roda a cada 3 horas e transfere automaticamente para a conta Cora
 * (via PIX) o saldo disponível na conta Asaas descontando:
 *   - Reserva para saques pendentes/em processamento de profissionais
 *   - Taxa de segurança configurável (ASAAS_AUTO_TRANSFER_RESERVE_BRL)
 *   - Valor mínimo para disparar a transferência (ASAAS_AUTO_TRANSFER_MIN_BRL)
 *
 * Variáveis de ambiente necessárias:
 *   CORA_PIX_KEY            — chave PIX da conta Cora (CNPJ, CPF, email ou aleatória)
 *   CORA_PIX_KEY_TYPE       — tipo da chave: CNPJ | CPF | EMAIL | EVP (default: CNPJ)
 *   ASAAS_AUTO_TRANSFER_MIN_BRL     — valor mínimo para disparar (default: 10.00)
 *   ASAAS_AUTO_TRANSFER_RESERVE_BRL — reserva fixa além dos saques pendentes (default: 50.00)
 *   ASAAS_AUTO_TRANSFER_ENABLED     — 'true' para habilitar (default: false — segurança)
 */

const logger = require('./logger');
const asaas = require('../services/asaasService');

const INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 horas

/**
 * Calcula total de saques que ainda não foram concluídos
 * (pending + processing) — precisam ficar reservados no Asaas.
 */
async function getPendingWithdrawalsTotal() {
  const WithdrawalRequest = require('../models/WithdrawalRequest');
  const agg = await WithdrawalRequest.aggregate([
    { $match: { status: { $in: ['pending', 'processing'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return agg[0]?.total || 0;
}

async function runAutoTransferJob() {
  // Verificar se o job está habilitado
  if (process.env.ASAAS_AUTO_TRANSFER_ENABLED !== 'true') {
    return; // silencioso quando desabilitado
  }

  if (!asaas.isConfigured()) {
    logger.warn('[autoTransfer] Asaas não configurado — job ignorado');
    return;
  }

  const coraPixKey = (process.env.CORA_PIX_KEY || '').trim();
  if (!coraPixKey) {
    logger.error('[autoTransfer] CORA_PIX_KEY não configurada — transferência cancelada');
    return;
  }

  const coraPixKeyType = (process.env.CORA_PIX_KEY_TYPE || 'CNPJ').trim().toUpperCase();
  const minTransfer = Number(process.env.ASAAS_AUTO_TRANSFER_MIN_BRL || 10);
  const fixedReserve = Number(process.env.ASAAS_AUTO_TRANSFER_RESERVE_BRL || 50);

  try {
    // 1. Saldo disponível no Asaas
    const { balance } = await asaas.getAccountBalance();
    logger.info(`[autoTransfer] Saldo Asaas: R$ ${balance.toFixed(2)}`);

    // 2. Reserva para saques pendentes dos profissionais
    const pendingWithdrawals = await getPendingWithdrawalsTotal();
    logger.info(`[autoTransfer] Saques pendentes/processing: R$ ${pendingWithdrawals.toFixed(2)}`);

    // 3. Valor disponível para transferir = saldo - saques pendentes - reserva fixa
    const reserved = pendingWithdrawals + fixedReserve;
    const transferValue = Number((balance - reserved).toFixed(2));

    logger.info(`[autoTransfer] Reserva total: R$ ${reserved.toFixed(2)} | Disponível para Cora: R$ ${transferValue.toFixed(2)}`);

    if (transferValue < minTransfer) {
      logger.info(`[autoTransfer] Valor disponível (R$ ${transferValue.toFixed(2)}) abaixo do mínimo (R$ ${minTransfer.toFixed(2)}) — transferência não realizada`);
      return;
    }

    // 4. Realizar transferência PIX para a Cora
    const transfer = await asaas.transferToPixKeyTyped(
      coraPixKey,
      coraPixKeyType,
      transferValue,
      `Repasse automático Já! — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    );

    logger.info(`[autoTransfer] ✅ Transferência para Cora realizada: R$ ${transferValue.toFixed(2)} | ID: ${transfer?.id}`);

  } catch (err) {
    logger.error('[autoTransfer] ❌ Erro na transferência automática:', { message: err.message });
  }
}

function startAutoTransferScheduler() {
  if (process.env.ASAAS_AUTO_TRANSFER_ENABLED !== 'true') {
    logger.info('[autoTransfer] Job desabilitado (ASAAS_AUTO_TRANSFER_ENABLED != true)');
    return;
  }

  logger.info('[autoTransfer] Scheduler de repasse automático iniciado (intervalo: 3h)');

  // Primeira execução após 2 minutos de warm-up (não na inicialização imediata)
  setTimeout(runAutoTransferJob, 2 * 60 * 1000);

  setInterval(runAutoTransferJob, INTERVAL_MS);
}

module.exports = { startAutoTransferScheduler };
