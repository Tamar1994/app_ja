const PricingConfig = require('../models/PricingConfig');
const ServiceType = require('../models/ServiceType');

function toObject(value) {
  if (!value || typeof value !== 'object') return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

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
      return { ok: false, error: `${field.label} deve ser >= ${field.min}` };
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

async function calculateCheckoutPricing({ hours, hasProducts, serviceTypeSlug = null, customFormData = {} }) {
  const cfg = await PricingConfig.getSingleton();
  const serviceType = serviceTypeSlug
    ? await ServiceType.findOne({ slug: serviceTypeSlug }).select('slug name checkoutFields status minHours maxHours hoursOptions pricePerMinute platformFeePercent')
    : null;

  const resolvedMinHours = Number.isFinite(Number(serviceType?.minHours))
    ? Number(serviceType.minHours)
    : Number(cfg.minHours);
  const resolvedMaxHours = Number.isFinite(Number(serviceType?.maxHours))
    ? Number(serviceType.maxHours)
    : Number(cfg.maxHours);
  const safeHours = normalizeNumber(hours, 0);
  if (!safeHours || safeHours < resolvedMinHours || safeHours > resolvedMaxHours) {
    throw new Error(`Horas devem ser entre ${resolvedMinHours} e ${resolvedMaxHours}`);
  }

  const serviceBasePrices = cfg.serviceBasePrices instanceof Map
    ? Object.fromEntries(cfg.serviceBasePrices)
    : (cfg.serviceBasePrices || {});
  const serviceBase = serviceTypeSlug && serviceBasePrices[serviceTypeSlug] !== undefined
    ? Number(serviceBasePrices[serviceTypeSlug])
    : null;

  const servicePricePerMinute = Number(serviceType?.pricePerMinute);
  let pricePerHour = Number.isFinite(servicePricePerMinute) && servicePricePerMinute > 0
    ? servicePricePerMinute * 60
    : (Number.isFinite(serviceBase) ? serviceBase : cfg.basePricePerHour);
  const supportsProducts = !serviceTypeSlug || serviceTypeSlug === 'diarista';
  if (supportsProducts && !hasProducts) pricePerHour += cfg.productsSurcharge;

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
    : Number(cfg.platformFeePercent);
  const platformFee = (estimated * resolvedPlatformFeePercent) / 100;

  return {
    config: cfg,
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
    usedServiceBasePrice: Number.isFinite(serviceBase),
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
