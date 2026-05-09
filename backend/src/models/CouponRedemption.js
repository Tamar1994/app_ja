const mongoose = require('mongoose');

const couponRedemptionSchema = new mongoose.Schema({
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
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
  paymentIntentId: {
    type: String,
    required: true,
    trim: true,
  },
  couponCodeSnapshot: {
    type: String,
    required: true,
    trim: true,
  },
  discountAmount: {
    type: Number,
    required: true,
    min: 0,
  },
}, { timestamps: true });

couponRedemptionSchema.index({ coupon: 1, user: 1, createdAt: -1 });
couponRedemptionSchema.index({ paymentIntentId: 1, coupon: 1 }, { unique: true });

module.exports = mongoose.model('CouponRedemption', couponRedemptionSchema);
