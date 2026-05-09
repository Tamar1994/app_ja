const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  discountType: {
    type: String,
    enum: ['percent', 'fixed'],
    required: true,
    default: 'percent',
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0,
  },
  maxDiscount: {
    type: Number,
    default: null,
  },
  minOrderValue: {
    type: Number,
    default: 0,
  },
  maxTotalUses: {
    type: Number,
    default: null,
  },
  maxUsesPerUser: {
    type: Number,
    default: 1,
  },
  stackable: {
    type: Boolean,
    default: false,
  },
  distributionType: {
    type: String,
    enum: ['none', 'all', 'clients', 'professionals', 'specific'],
    default: 'none',
  },
  specificUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  startsAt: {
    type: Date,
    default: null,
  },
  endsAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
    default: null,
  },
}, { timestamps: true });

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ distributionType: 1, isActive: 1 });

module.exports = mongoose.model('Coupon', couponSchema);
