const ServiceType = require('../models/ServiceType');

const FALLBACK_PLATFORM_FEE_PCT = 15;

/**
 * Calcula o pricing com base no novo modelo de faixas fixas + upsells.
 *
 * @param {object} params
 * @param {string}   params.serviceTypeSlug  - slug do servico
 * @param {string}   params.tierLabel        - label da faixa escolhida (ex: "8h")
 * @param {string[]} params.selectedUpsells  - keys dos upsells selecionados
 *
 * @returns {{ serviceType, tier, upsells, tierPrice, upsellsTotal, estimated,
 *             platformFeePercent, platformFee, amountCents }}
 */
async function calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells = [] }) {
  if (!serviceTypeSlug) {
    throw Object.assign(new Error('serviceTypeSlug e obrigatorio'), { status: 400 });
  }
  if (!tierLabel) {
    throw Object.assign(new Error('tierLabel e obrigatorio'), { status: 400 });
  }

  const serviceType = await ServiceType.findOne({ slug: serviceTypeSlug })
    .select('slug name priceTiers upsells platformFeePercent requiresLocationTracking status');

  if (!serviceType) {
    throw Object.assign(new Error('Tipo de servico nao encontrado'), { status: 400 });
  }
  if (serviceType.status !== 'enabled') {
    throw Object.assign(new Error('Este servico nao esta disponivel no momento'), { status: 400 });
  }

  const tier = (serviceType.priceTiers || []).find((t) => t.label === tierLabel);
  if (!tier) {
    throw Object.assign(new Error(`Faixa "${tierLabel}" nao disponivel para este servico`), { status: 400 });
  }

  const validUpsellKeys = new Set((serviceType.upsells || []).map((u) => u.key));
  const appliedUpsells = (selectedUpsells || [])
    .filter((key) => validUpsellKeys.has(key))
    .map((key) => {
      const u = serviceType.upsells.find((u) => u.key === key);
      return { key: u.key, label: u.label, price: u.price };
    });

  const tierPrice    = Number(tier.price);
  const upsellsTotal = appliedUpsells.reduce((sum, u) => sum + Number(u.price), 0);
  const estimated    = tierPrice + upsellsTotal;

  const platformFeePercent = Number.isFinite(Number(serviceType.platformFeePercent))
    ? Number(serviceType.platformFeePercent)
    : FALLBACK_PLATFORM_FEE_PCT;
  const platformFee = Math.round(estimated * platformFeePercent) / 100;

  return {
    serviceType,
    tier,
    upsells: appliedUpsells,
    tierPrice,
    upsellsTotal,
    estimated,
    platformFeePercent,
    platformFee,
    amountCents: Math.round(estimated * 100),
  };
}

module.exports = { calculateCheckoutPricing };
