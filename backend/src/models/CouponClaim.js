const mongoose = require('mongoose');

const couponClaimSchema = new mongoose.Schema({
  coupon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  claimedVia: {
    type: String,
    enum: ['code', 'distribution', 'admin'],
    default: 'code',
  },
}, { timestamps: true });

couponClaimSchema.index({ coupon: 1, user: 1 }, { unique: true });
couponClaimSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('CouponClaim', couponClaimSchema);
