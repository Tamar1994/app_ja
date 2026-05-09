const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function normalizeCouponCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '');
}

function generateCouponCode(prefix = 'JA') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${normalizeCouponCode(prefix)}-${rand}`;
}

function isCouponTargetingUser(coupon, user) {
  if (!coupon || !user) return false;
  if (coupon.distributionType === 'none' || coupon.distributionType === 'all') return true;
  if (coupon.distributionType === 'clients') return user.userType === 'client';
  if (coupon.distributionType === 'professionals') return user.userType === 'professional';
  if (coupon.distributionType === 'specific') {
    return (coupon.specificUsers || []).some((id) => id.toString() === user._id.toString());
  }
  return true;
}

function isCouponWithinDateRange(coupon, now = new Date()) {
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return false;
  if (coupon.endsAt && new Date(coupon.endsAt) < now) return false;
  return true;
}

async function getUsageCounts(couponId, userId) {
  const [totalUsed, userUsed] = await Promise.all([
    CouponRedemption.countDocuments({ coupon: couponId }),
    CouponRedemption.countDocuments({ coupon: couponId, user: userId }),
  ]);
  return { totalUsed, userUsed };
}

async function validateSingleCoupon(coupon, user, options = {}) {
  const { orderSubtotal = null, ignoreMinOrder = false } = options;

  if (!coupon || !coupon.isActive) {
    return { ok: false, reason: 'Cupom inativo.' };
  }

  if (!isCouponWithinDateRange(coupon)) {
    return { ok: false, reason: 'Cupom fora do período de validade.' };
  }

  if (!isCouponTargetingUser(coupon, user)) {
    return { ok: false, reason: 'Este cupom não está disponível para o seu perfil.' };
  }

  if (!ignoreMinOrder && Number.isFinite(orderSubtotal) && Number(coupon.minOrderValue || 0) > orderSubtotal) {
    return {
      ok: false,
      reason: `Pedido mínimo de R$ ${Number(coupon.minOrderValue).toFixed(2)} para este cupom.`,
    };
  }

  const { totalUsed, userUsed } = await getUsageCounts(coupon._id, user._id);

  if (Number.isFinite(coupon.maxTotalUses) && coupon.maxTotalUses > 0 && totalUsed >= coupon.maxTotalUses) {
    return { ok: false, reason: 'Cupom esgotado (limite total atingido).' };
  }

  if (Number.isFinite(coupon.maxUsesPerUser) && coupon.maxUsesPerUser > 0 && userUsed >= coupon.maxUsesPerUser) {
    return { ok: false, reason: 'Você já atingiu o limite de uso desse cupom.' };
  }

  return { ok: true };
}

function applyCouponsToSubtotal(coupons, subtotal) {
  let runningTotal = round2(subtotal);
  const appliedCoupons = [];

  for (const coupon of coupons) {
    if (runningTotal <= 0) break;

    let discount = 0;
    if (coupon.discountType === 'percent') {
      discount = runningTotal * (Number(coupon.discountValue || 0) / 100);
      if (Number.isFinite(coupon.maxDiscount) && coupon.maxDiscount > 0) {
        discount = Math.min(discount, Number(coupon.maxDiscount));
      }
    } else {
      discount = Number(coupon.discountValue || 0);
    }

    discount = round2(Math.max(0, Math.min(discount, runningTotal)));
    if (discount <= 0) continue;

    runningTotal = round2(runningTotal - discount);
    appliedCoupons.push({
      couponId: coupon._id,
      code: coupon.code,
      discountAmount: discount,
      stackable: !!coupon.stackable,
    });
  }

  const totalDiscount = round2(appliedCoupons.reduce((sum, c) => sum + c.discountAmount, 0));
  return {
    subtotal: round2(subtotal),
    totalDiscount,
    finalTotal: round2(Math.max(0, subtotal - totalDiscount)),
    appliedCoupons,
  };
}

async function resolveCouponsForCheckout({ couponCodes, user, orderSubtotal }) {
  const normalizedCodes = Array.from(new Set((couponCodes || [])
    .map((c) => normalizeCouponCode(c))
    .filter(Boolean)));

  if (!normalizedCodes.length) {
    return {
      validCoupons: [],
      rejectedCoupons: [],
      pricing: applyCouponsToSubtotal([], orderSubtotal || 0),
    };
  }

  const coupons = await Coupon.find({ code: { $in: normalizedCodes } });
  const byCode = new Map(coupons.map((c) => [c.code, c]));

  const validCoupons = [];
  const rejectedCoupons = [];

  for (const code of normalizedCodes) {
    const coupon = byCode.get(code);
    if (!coupon) {
      rejectedCoupons.push({ code, reason: 'Cupom não encontrado.' });
      continue;
    }

    const validation = await validateSingleCoupon(coupon, user, { orderSubtotal });
    if (!validation.ok) {
      rejectedCoupons.push({ code, reason: validation.reason });
      continue;
    }

    validCoupons.push(coupon);
  }

  if (validCoupons.length > 1) {
    const nonStackable = validCoupons.find((c) => !c.stackable);
    if (nonStackable) {
      const keepCode = nonStackable.code;
      const onlyOne = validCoupons.filter((c) => c.code === keepCode);
      validCoupons.length = 0;
      validCoupons.push(...onlyOne);
      normalizedCodes.forEach((code) => {
        if (code !== keepCode && !rejectedCoupons.some((r) => r.code === code)) {
          rejectedCoupons.push({
            code,
            reason: `O cupom ${keepCode} não permite uso com outros cupons.`,
          });
        }
      });
    }
  }

  return {
    validCoupons,
    rejectedCoupons,
    pricing: applyCouponsToSubtotal(validCoupons, Number(orderSubtotal || 0)),
  };
}

module.exports = {
  Coupon,
  normalizeCouponCode,
  generateCouponCode,
  isCouponTargetingUser,
  isCouponWithinDateRange,
  validateSingleCoupon,
  resolveCouponsForCheckout,
  applyCouponsToSubtotal,
  getUsageCounts,
};
