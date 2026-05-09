const express = require('express');
const auth = require('../middleware/auth');
const Coupon = require('../models/Coupon');
const CouponClaim = require('../models/CouponClaim');
const {
  normalizeCouponCode,
  validateSingleCoupon,
  getUsageCounts,
} = require('../services/couponService');

const router = express.Router();

function getDistributionFilterForUser(user) {
  const or = [{ distributionType: 'all' }];
  if (user.userType === 'client') or.push({ distributionType: 'clients' });
  if (user.userType === 'professional') or.push({ distributionType: 'professionals' });
  or.push({ distributionType: 'specific', specificUsers: user._id });
  return { $or: or };
}

// GET /api/coupons/my
router.get('/my', auth, async (req, res) => {
  try {
    const claims = await CouponClaim.find({ user: req.user._id }).select('coupon');
    const claimedIds = claims.map((c) => c.coupon);

    const distributionFilter = getDistributionFilterForUser(req.user);

    const coupons = await Coupon.find({
      isActive: true,
      $or: [
        { _id: { $in: claimedIds } },
        distributionFilter,
      ],
    }).sort({ endsAt: 1, createdAt: -1 });

    const claimedSet = new Set(claimedIds.map((id) => id.toString()));

    const data = await Promise.all(coupons.map(async (coupon) => {
      const { totalUsed, userUsed } = await getUsageCounts(coupon._id, req.user._id);
      const validation = await validateSingleCoupon(coupon, req.user, { ignoreMinOrder: true });
      return {
        id: coupon._id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        maxDiscount: coupon.maxDiscount,
        minOrderValue: coupon.minOrderValue,
        stackable: coupon.stackable,
        startsAt: coupon.startsAt,
        endsAt: coupon.endsAt,
        distributionType: coupon.distributionType,
        maxTotalUses: coupon.maxTotalUses,
        maxUsesPerUser: coupon.maxUsesPerUser,
        usage: { totalUsed, userUsed },
        claimed: claimedSet.has(coupon._id.toString()),
        canUseNow: validation.ok,
        blockedReason: validation.ok ? null : validation.reason,
      };
    }));

    res.json({ coupons: data });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar carteira de cupons' });
  }
});

// POST /api/coupons/redeem
router.post('/redeem', auth, async (req, res) => {
  const code = normalizeCouponCode(req.body.code);
  if (!code) return res.status(400).json({ message: 'Informe um código válido' });

  try {
    const coupon = await Coupon.findOne({ code });
    if (!coupon) return res.status(404).json({ message: 'Cupom não encontrado' });

    const validation = await validateSingleCoupon(coupon, req.user, { ignoreMinOrder: true });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.reason });
    }

    const existing = await CouponClaim.findOne({ coupon: coupon._id, user: req.user._id });
    if (existing) {
      return res.json({ message: 'Cupom já está na sua carteira', coupon: { code: coupon.code, title: coupon.title } });
    }

    await CouponClaim.create({ coupon: coupon._id, user: req.user._id, claimedVia: 'code' });

    res.json({ message: 'Cupom resgatado com sucesso!', coupon: { code: coupon.code, title: coupon.title } });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao resgatar cupom' });
  }
});

module.exports = router;
