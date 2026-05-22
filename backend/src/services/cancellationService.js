/**
 * cancellationService.js
 *
 * Lógica de cálculo da taxa de cancelamento baseada nas configurações
 * definidas pelo admin por cidade e/ou tipo de serviço.
 */

const ServiceCoverageCity = require('../models/ServiceCoverageCity');
const CancellationConfig  = require('../models/CancellationConfig');

// Normaliza texto para comparação (remove acentos, lowercase)
function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Encontra o CoverageCity pelo nome (com tolerância a acentuação).
 * @param {string} city
 * @param {string} [state]
 * @returns {Promise<{_id: ObjectId}|null>}
 */
async function findCoverageCityId(city, state) {
  if (!city) return null;
  const normCity  = normalizeText(city);
  const normState = normalizeText(state || '');
  let doc = normState
    ? await ServiceCoverageCity.findOne({ normalizedCity: normCity, normalizedState: normState, isActive: true }).lean()
    : null;
  if (!doc) {
    doc = await ServiceCoverageCity.findOne({ normalizedCity: normCity, isActive: true }).lean();
  }
  return doc?._id || null;
}

/**
 * Encontra a CancellationConfig mais específica para a combinação cidade+tipo.
 *
 * Prioridade (maior → menor):
 *   1. cidade específica + tipo específico
 *   2. cidade específica + qualquer tipo
 *   3. qualquer cidade + tipo específico
 *   4. global (qualquer cidade, qualquer tipo)
 *
 * @param {mongoose.Types.ObjectId|null} coverageCityId
 * @param {string|null} serviceTypeSlug
 * @returns {Promise<CancellationConfig|null>}
 */
async function findCancellationConfig(coverageCityId, serviceTypeSlug) {
  const orClauses = [];

  if (coverageCityId && serviceTypeSlug) {
    orClauses.push({ coverageCityId, serviceTypeSlug });
  }
  if (coverageCityId) {
    orClauses.push({ coverageCityId, serviceTypeSlug: null });
  }
  if (serviceTypeSlug) {
    orClauses.push({ coverageCityId: null, serviceTypeSlug });
  }
  orClauses.push({ coverageCityId: null, serviceTypeSlug: null });

  const candidates = await CancellationConfig.find({
    status: 'active',
    $or: orClauses,
  }).lean();

  const priority = (c) => {
    const hasCity = c.coverageCityId != null;
    const hasSlug = c.serviceTypeSlug != null;
    if (hasCity && hasSlug) return 3;
    if (hasCity)            return 2;
    if (hasSlug)            return 1;
    return 0;
  };

  candidates.sort((a, b) => priority(b) - priority(a));
  return candidates[0] || null;
}

/**
 * Calcula a taxa aplicável ao cancelamento de um pedido.
 *
 * Retorna um objeto com:
 *  - phase              : objeto da fase aplicada (ou null)
 *  - platformFeePercent : % que fica na plataforma
 *  - professionalFeePercent : % que vai ao profissional
 *  - totalFeePercent    : platformFeePercent + professionalFeePercent
 *  - refundPercent      : 100 - totalFeePercent
 *
 * @param {CancellationConfig|null} config
 * @param {ServiceRequest} request  objeto lean do pedido
 * @returns {{ phase, platformFeePercent, professionalFeePercent, totalFeePercent, refundPercent }}
 */
function computeCancellationFee(config, request) {
  const zero = {
    phase: null,
    platformFeePercent: 0,
    professionalFeePercent: 0,
    totalFeePercent: 0,
    refundPercent: 100,
  };

  if (!config) return zero;

  const now = new Date();
  let phase = null;

  if (request.requestType === 'scheduled') {
    const hoursUntil = (new Date(request.details.scheduledDate) - now) / (1000 * 60 * 60);
    // Ordena DESC por hoursBeforeScheduled; aplica a fase com MAIOR threshold ≤ hoursUntil
    const sorted = [...(config.scheduledPhases || [])].sort(
      (a, b) => b.hoursBeforeScheduled - a.hoursBeforeScheduled,
    );
    phase = sorted.find((p) => hoursUntil >= p.hoursBeforeScheduled) || null;
    // Se não encontrou (ex.: horário já passou), usa fase de maior taxa (última sorted DESC)
    if (!phase && sorted.length) phase = sorted[sorted.length - 1];
  } else {
    // Pedido imediato: mede tempo desde o aceite
    if (!request.acceptedAt) {
      // Pedido ainda não aceito → sem taxa
      const PRE_ACCEPT = ['searching', 'pending_professional', 'pending_client'];
      if (!request.status || PRE_ACCEPT.includes(request.status)) return zero;
      // Pedido já aceito mas acceptedAt ausente (inconsistência de dados):
      // usa createdAt como fallback conservador (mais tempo = fase de taxa maior)
      console.warn('[cancellationFee] acceptedAt ausente para pedido aceito (%s), usando createdAt como fallback', request._id);
    }
    const minutesSince = (now - new Date(request.acceptedAt || request.createdAt)) / (1000 * 60);
    // Ordena DESC por minutesAfterAccepted; aplica fase com MAIOR threshold ≤ minutesSince
    const sorted = [...(config.immediatePhases || [])].sort(
      (a, b) => b.minutesAfterAccepted - a.minutesAfterAccepted,
    );
    phase = sorted.find((p) => minutesSince >= p.minutesAfterAccepted) || null;
    if (!phase && sorted.length) phase = sorted[sorted.length - 1];
  }

  if (!phase) return zero;

  const platformFeePercent     = Number(phase.platformFeePercent || 0);
  const professionalFeePercent = Number(phase.professionalFeePercent || 0);
  const totalFeePercent        = Number((platformFeePercent + professionalFeePercent).toFixed(4));
  const refundPercent          = Math.max(0, 100 - totalFeePercent);

  return { phase, platformFeePercent, professionalFeePercent, totalFeePercent, refundPercent };
}

/**
 * Calcula os valores monetários do cancelamento.
 *
 * @param {object} feeResult  retorno de computeCancellationFee
 * @param {ServiceRequest}  request  objeto lean
 * @returns {{
 *   totalPaid, feeAmount,
 *   externalPaid, walletClientPaid, walletProfessionalPaid,
 *   externalRefundAmount, walletClientRefundAmount, walletProfessionalRefundAmount,
 *   professionalEarning
 * }}
 */
function computeRefundAmounts(feeResult, request) {
  const { totalFeePercent, professionalFeePercent } = feeResult;
  const p = request.pricing || {};

  const externalPaid          = Number(p.customerPaidExternal   || 0);
  const walletClientPaid      = Number(p.walletAppliedClient    || 0);
  const walletProfessionalPaid= Number(p.walletAppliedProfessional || 0);
  const totalPaid             = externalPaid + walletClientPaid + walletProfessionalPaid;

  if (totalPaid <= 0) {
    return {
      totalPaid: 0, feeAmount: 0,
      externalPaid: 0, walletClientPaid: 0, walletProfessionalPaid: 0,
      externalRefundAmount: 0, walletClientRefundAmount: 0, walletProfessionalRefundAmount: 0,
      professionalEarning: 0,
    };
  }

  const feeAmount    = Number((totalPaid * totalFeePercent     / 100).toFixed(2));
  const totalRefund  = Number((totalPaid - feeAmount).toFixed(2));
  const refundRatio  = totalRefund / totalPaid;

  const externalRefundAmount           = Number((externalPaid           * refundRatio).toFixed(2));
  const walletClientRefundAmount       = Number((walletClientPaid       * refundRatio).toFixed(2));
  const walletProfessionalRefundAmount = Number((walletProfessionalPaid * refundRatio).toFixed(2));

  const professionalEarning = Number((totalPaid * professionalFeePercent / 100).toFixed(2));

  return {
    totalPaid,
    feeAmount,
    externalPaid,
    walletClientPaid,
    walletProfessionalPaid,
    externalRefundAmount,
    walletClientRefundAmount,
    walletProfessionalRefundAmount,
    professionalEarning,
  };
}

module.exports = {
  findCoverageCityId,
  findCancellationConfig,
  computeCancellationFee,
  computeRefundAmounts,
};
