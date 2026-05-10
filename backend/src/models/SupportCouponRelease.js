const mongoose = require('mongoose');

const supportCouponReleaseSchema = new mongoose.Schema({
  coupon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon',
    required: true,
  },
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    required: true,
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  reason: {
    type: String,
    default: '',
    trim: true,
  },
  supervisorNote: {
    type: String,
    default: '',
    trim: true,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    default: null,
  },
}, { timestamps: true });

supportCouponReleaseSchema.index({ requestedBy: 1, createdAt: -1 });
supportCouponReleaseSchema.index({ supervisor: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SupportCouponRelease', supportCouponReleaseSchema);
