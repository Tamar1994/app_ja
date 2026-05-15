const ServiceType = require('../models/ServiceType');

const FALLBACK_PLATFORM_FEE_PCT = 15;

// Retorna a hora decimal (ex: 20.5 = 20:30) no fuso horário de Brasília,
// independente do fuso do servidor (que costuma ser UTC em produção).
function getBrazilDecimalHour(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h + m / 60;
}

function minuteInNightWindow(minuteOfDay, nightStartMin, nightEndMin) {
  if (nightStartMin === nightEndMin) return true;
  if (nightStartMin < nightEndMin) {
    return minuteOfDay >= nightStartMin && minuteOfDay < nightEndMin;
  }
  return minuteOfDay >= nightStartMin || minuteOfDay < nightEndMin;
}

/**
 * Calcula proporcional diurno/noturno para uma faixa de preco.
 * @returns {{ tierPrice: number, dayNightBreakdown: object|null }}
 */
function calcDayNightPrice(tier, nightRateStartHour, nightRateEndHour, scheduledDate) {
  const tierNightPrice = tier.nightPrice != null && Number.isFinite(Number(tier.nightPrice))
    ? Number(tier.nightPrice)
    : null;

  if (
    nightRateStartHour == null ||
    nightRateEndHour == null ||
    !Number.isFinite(nightRateStartHour) ||
    !Number.isFinite(nightRateEndHour) ||
    tierNightPrice == null ||
    !scheduledDate
  ) {
    return { tierPrice: Number(tier.price), dayNightBreakdown: null };
  }

  const start = new Date(scheduledDate);
  const totalMin = Number(tier.durationMinutes);
  const startMinuteOfDay = Math.round(getBrazilDecimalHour(start) * 60) % 1440;
  const nightStartMin = Math.round(Number(nightRateStartHour) * 60) % 1440;
  const nightEndMin = Math.round(Number(nightRateEndHour) * 60) % 1440;

  let nightMinutes = 0;
  for (let i = 0; i < totalMin; i += 1) {
    const minuteOfDay = (startMinuteOfDay + i) % 1440;
    if (minuteInNightWindow(minuteOfDay, nightStartMin, nightEndMin)) nightMinutes += 1;
  }
  const dayMinutes = totalMin - nightMinutes;

  const dayRatePerMin = Number(tier.price) / totalMin;
  const nightRatePerMin = tierNightPrice / totalMin;
  const dayAmount  = Math.round(dayRatePerMin  * dayMinutes  * 100) / 100;
  const nightAmount = Math.round(nightRatePerMin * nightMinutes * 100) / 100;
  const mixedPrice  = Math.round((dayAmount + nightAmount) * 100) / 100;

  return {
    tierPrice: mixedPrice,
    dayNightBreakdown: { dayMinutes, nightMinutes, dayPrice: dayAmount, nightPrice: nightAmount, nightRateStartHour, nightRateEndHour },
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
    .select('slug name priceTiers upsells platformFeePercent nightRateStartHour nightRateEndHour requiresLocationTracking status');

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
    serviceType.nightRateStartHour != null
      ? (serviceType.nightRateEndHour != null ? Number(serviceType.nightRateEndHour) : 6)
      : null,
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
