const ServiceType = require('../models/ServiceType');

const FALLBACK_PLATFORM_FEE_PCT = 15;

/**
 * Calcula proporcional diurno/noturno para uma faixa de preco.
 * @returns {{ tierPrice: number, dayNightBreakdown: object|null }}
 */
function calcDayNightPrice(tier, nightRateStartHour, scheduledDate) {
  const tierNightPrice = tier.nightPrice != null && Number.isFinite(Number(tier.nightPrice))
    ? Number(tier.nightPrice)
    : null;

  if (
    nightRateStartHour == null ||
    !Number.isFinite(nightRateStartHour) ||
    tierNightPrice == null ||
    !scheduledDate
  ) {
    return { tierPrice: Number(tier.price), dayNightBreakdown: null };
  }

  const start = new Date(scheduledDate);
  const totalMin = Number(tier.durationMinutes);
  const startDecimalHour = start.getHours() + start.getMinutes() / 60;
  const endDecimalHour = startDecimalHour + totalMin / 60;

  if (endDecimalHour <= nightRateStartHour) {
    // 100% diurno
    return {
      tierPrice: Number(tier.price),
      dayNightBreakdown: { dayMinutes: totalMin, nightMinutes: 0, dayPrice: Number(tier.price), nightPrice: 0, nightRateStartHour },
    };
  }

  if (startDecimalHour >= nightRateStartHour) {
    // 100% noturno
    return {
      tierPrice: tierNightPrice,
      dayNightBreakdown: { dayMinutes: 0, nightMinutes: totalMin, dayPrice: 0, nightPrice: tierNightPrice, nightRateStartHour },
    };
  }

  // Misto: parte diurna + parte noturna
  const dayMinutes = Math.round((nightRateStartHour - startDecimalHour) * 60);
  const nightMinutes = totalMin - dayMinutes;
  const dayRatePerMin = Number(tier.price) / totalMin;
  const nightRatePerMin = tierNightPrice / totalMin;
  const dayAmount  = Math.round(dayRatePerMin  * dayMinutes  * 100) / 100;
  const nightAmount = Math.round(nightRatePerMin * nightMinutes * 100) / 100;
  const mixedPrice  = Math.round((dayAmount + nightAmount) * 100) / 100;

  return {
    tierPrice: mixedPrice,
    dayNightBreakdown: { dayMinutes, nightMinutes, dayPrice: dayAmount, nightPrice: nightAmount, nightRateStartHour },
  };
}

/**
 * Calcula o pricing com base no novo modelo de faixas fixas + upsells.
 *
 * @param {object} params
 * @param {string}        params.serviceTypeSlug  - slug do servico
 * @param {string}        params.tierLabel        - label da faixa escolhida (ex: "8h")
 * @param {string[]}      params.selectedUpsells  - keys dos upsells selecionados
 * @param {string|Date|null} params.scheduledDate - data/hora de inicio (para calculo diurno/noturno)
 *
 * @returns {{ serviceType, tier, upsells, tierPrice, upsellsTotal, estimated,
 *             platformFeePercent, platformFee, amountCents, dayNightBreakdown }}
 */
async function calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells = [], scheduledDate = null }) {
  if (!serviceTypeSlug) {
    throw Object.assign(new Error('serviceTypeSlug e obrigatorio'), { status: 400 });
  }
  if (!tierLabel) {
    throw Object.assign(new Error('tierLabel e obrigatorio'), { status: 400 });
  }

  const serviceType = await ServiceType.findOne({ slug: serviceTypeSlug })
    .select('slug name priceTiers upsells platformFeePercent nightRateStartHour requiresLocationTracking status');

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

  const { tierPrice, dayNightBreakdown } = calcDayNightPrice(
    tier,
    serviceType.nightRateStartHour != null ? Number(serviceType.nightRateStartHour) : null,
    scheduledDate,
  );
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
    dayNightBreakdown,
  };
}

module.exports = { calculateCheckoutPricing };
