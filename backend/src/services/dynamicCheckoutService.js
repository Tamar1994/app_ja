const ServiceType = require('../models/ServiceType');

const FALLBACK_PLATFORM_FEE_PCT = 15;

/**
 * Calcula o pricing com base no novo modelo de faixas fixas + upsells.
 *
 * @param {object} params
 * @param {string}   params.serviceTypeSlug  - slug do serviço
 * @param {string}   params.tierLabel        - label da faixa escolhida (ex: "8h")
 * @param {string[]} params.selectedUpsells  - keys dos upsells selecionados
 *
 * @returns {{ serviceType, tier, upsells, tierPrice, upsellsTotal, estimated,
 *             platformFeePercent, platformFee, amountCents }}
 */
async function calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells = [] }) {
  if (!serviceTypeSlug) {
    throw Object.assign(new Error('serviceTypeSlug é obrigatório'), { status: 400 });
  }
  if (!tierLabel) {
    throw Object.assign(new Error('tierLabel é obrigatório'), { status: 400 });
  }

  const serviceType = await ServiceType.findOne({ slug: serviceTypeSlug })
    .select('slug name priceTiers upsells platformFeePercent requiresLocationTracking status');

  if (!serviceType) {
    throw Object.assign(new Error('Tipo de serviço não encontrado'), { status: 400 });
  }
  if (serviceType.status !== 'enabled') {
    throw Object.assign(new Error('Este serviço não está disponível no momento'), { status: 400 });
  }

  const tier = (serviceType.priceTiers || []).find((t) => t.label === tierLabel);
  if (!tier) {
    throw Object.assign(new Error(`Faixa "${tierLabel}" não disponível para este serviço`), { status: 400 });
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


function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFieldValue(field, rawValue) {
  const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '';
  const source = hasValue ? rawValue : field.defaultValue;

  if (field.inputType === 'boolean') {
    const boolValue = source === true || source === 'true' || source === 1 || source === '1';
    if (field.required && !boolValue) {
      return { ok: false, error: `${field.label} e obrigatorio` };
    }
    return { ok: true, value: boolValue };
  }

  if (field.inputType === 'number') {
    const numberValue = normalizeNumber(source, NaN);
    if (!Number.isFinite(numberValue)) {
      if (field.required) return { ok: false, error: `${field.label} e obrigatorio` };
      return { ok: true, value: null };
    }

    if (Number.isFinite(field.min) && numberValue < field.min) {
      if (field.required) {
        return { ok: false, error: `${field.label} deve ser >= ${field.min}` };
      }
      // Não obrigatório: clamp para o mínimo (ou usa defaultValue se >= min)
      const dv = Number(field.defaultValue);
      const fallback = Number.isFinite(dv) && dv >= field.min ? dv : field.min;
      return { ok: true, value: fallback };
    }
    if (Number.isFinite(field.max) && numberValue > field.max) {
      return { ok: false, error: `${field.label} deve ser <= ${field.max}` };
    }

    return { ok: true, value: numberValue };
  }

  if (field.inputType === 'select') {
    const stringValue = String(source || '').trim();
    if (!stringValue) {
      if (field.required) return { ok: false, error: `${field.label} e obrigatorio` };
      return { ok: true, value: null };
    }
    const validValues = new Set((field.options || []).map((opt) => String(opt.value)));
    if (!validValues.has(stringValue)) {
      return { ok: false, error: `${field.label} invalido` };
    }
    return { ok: true, value: stringValue };
  }

  const textValue = String(source || '').trim();
  if (field.required && !textValue) {
    return { ok: false, error: `${field.label} e obrigatorio` };
  }
  return { ok: true, value: textValue || null };
}

function calculateDynamicAdjustments({ fields, values, hours }) {
  let extraTotal = 0;
  let extraPerHour = 0;
  const breakdown = [];

  for (const field of fields) {
    if (!field.pricingEnabled) continue;
    const fieldValue = values[field.key];
    if (fieldValue === null || fieldValue === undefined || fieldValue === '') continue;

    let units = 0;
    let labelSuffix = '';

    if (field.inputType === 'number') {
      units = normalizeNumber(fieldValue, 0);
      labelSuffix = ` (${units})`;
    } else if (field.inputType === 'boolean') {
      if (!fieldValue) continue;
      units = 1;
    } else if (field.inputType === 'select') {
      const option = (field.options || []).find((opt) => String(opt.value) === String(fieldValue));
      if (!option) continue;
      units = normalizeNumber(option.priceImpact, 0);
      labelSuffix = ` (${option.label})`;
    } else {
      continue;
    }

    if (field.inputType !== 'select') {
      units = units * normalizeNumber(field.pricingAmount, 0);
    }

    if (!units) continue;

    if (field.pricingMode === 'add_per_hour') {
      extraPerHour += units;
      breakdown.push({
        key: field.key,
        label: `${field.label}${labelSuffix}`,
        mode: 'add_per_hour',
        amount: units,
      });
    } else {
      extraTotal += units;
      breakdown.push({
        key: field.key,
        label: `${field.label}${labelSuffix}`,
        mode: 'add_total',
        amount: units,
      });
    }
  }

  return { extraTotal, extraPerHour, breakdown };
}

function formatSummaryValue(field, value) {
  if (value === null || value === undefined || value === '') return '-';
  if (field.inputType === 'boolean') return value ? 'Sim' : 'Nao';
  if (field.inputType === 'select') {
    const option = (field.options || []).find((opt) => String(opt.value) === String(value));
    return option?.label || String(value);
  }
  return String(value);
}

// Fallbacks globais usados quando o ServiceType não define o campo
const FALLBACK_MIN_HOURS        = 2;
const FALLBACK_MAX_HOURS        = 12;
const FALLBACK_PLATFORM_FEE_PCT = 15;
const FALLBACK_BASE_PRICE_HOUR  = 35;
const FALLBACK_PRODUCTS_SURCHARGE = 5;

async function calculateCheckoutPricing({ hours, hasProducts, serviceTypeSlug = null, customFormData = {} }) {
  const serviceType = serviceTypeSlug
    ? await ServiceType.findOne({ slug: serviceTypeSlug }).select('slug name checkoutFields status minHours maxHours hoursOptions pricePerMinute platformFeePercent')
    : null;

  const resolvedMinHours = Number.isFinite(Number(serviceType?.minHours))
    ? Number(serviceType.minHours)
    : FALLBACK_MIN_HOURS;
  const resolvedMaxHours = Number.isFinite(Number(serviceType?.maxHours))
    ? Number(serviceType.maxHours)
    : FALLBACK_MAX_HOURS;
  const safeHours = normalizeNumber(hours, 0);
  if (!safeHours || safeHours < resolvedMinHours || safeHours > resolvedMaxHours) {
    throw new Error(`Horas devem ser entre ${resolvedMinHours} e ${resolvedMaxHours}`);
  }

  const servicePricePerMinute = Number(serviceType?.pricePerMinute);
  let pricePerHour = Number.isFinite(servicePricePerMinute) && servicePricePerMinute > 0
    ? servicePricePerMinute * 60
    : FALLBACK_BASE_PRICE_HOUR;
  const supportsProducts = !serviceTypeSlug || serviceTypeSlug === 'diarista';
  if (supportsProducts && !hasProducts) pricePerHour += FALLBACK_PRODUCTS_SURCHARGE;

  const fields = Array.isArray(serviceType?.checkoutFields)
    ? [...serviceType.checkoutFields].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    : [];

  const provided = toObject(customFormData);
  const normalizedCustomFormData = {};
  for (const field of fields) {
    const normalized = normalizeFieldValue(field, provided[field.key]);
    if (!normalized.ok) {
      const err = new Error(normalized.error || 'Campo customizado invalido');
      err.status = 400;
      throw err;
    }
    normalizedCustomFormData[field.key] = normalized.value;
  }

  const dynamic = calculateDynamicAdjustments({
    fields,
    values: normalizedCustomFormData,
    hours: safeHours,
  });
  const customFormSummary = fields.map((field) => ({
    key: field.key,
    label: field.label,
    inputType: field.inputType,
    value: normalizedCustomFormData[field.key],
    displayValue: formatSummaryValue(field, normalizedCustomFormData[field.key]),
  }));

  const adjustedPricePerHour = pricePerHour + dynamic.extraPerHour;
  const estimated = (adjustedPricePerHour * safeHours) + dynamic.extraTotal;
  const resolvedPlatformFeePercent = Number.isFinite(Number(serviceType?.platformFeePercent))
    ? Number(serviceType.platformFeePercent)
    : FALLBACK_PLATFORM_FEE_PCT;
  const platformFee = (estimated * resolvedPlatformFeePercent) / 100;

  return {
    serviceType,
    fields,
    normalizedCustomFormData,
    customFormSummary,
    pricingBreakdown: dynamic.breakdown,
    basePricePerHour: pricePerHour,
    dynamicExtraPerHour: dynamic.extraPerHour,
    dynamicExtraTotal: dynamic.extraTotal,
    pricePerHour: adjustedPricePerHour,
    estimated,
    platformFee,
    amountCents: Math.round(estimated * 100),
    usedServiceBasePrice: false,
    usedServiceMinutePrice: Number.isFinite(servicePricePerMinute) && servicePricePerMinute > 0,
    platformFeePercent: resolvedPlatformFeePercent,
    minHours: resolvedMinHours,
    maxHours: resolvedMaxHours,
    supportsProducts,
  };
}

module.exports = {
  calculateCheckoutPricing,
};
