const mongoose = require('mongoose');

const coraPixChargeSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  coraInvoiceId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  coraStatus: {
    type: String,
    default: 'OPEN',
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'expired', 'cancelled', 'failed'],
    default: 'pending',
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  subtotal: {
    type: Number,
    required: true,
  },
  discountTotal: {
    type: Number,
    default: 0,
  },
  walletAppliedTotal: {
    type: Number,
    default: 0,
  },
  walletAppliedClient: {
    type: Number,
    default: 0,
  },
  walletAppliedProfessional: {
    type: Number,
    default: 0,
  },
  appliedCoupons: [{
    code: { type: String, required: true },
    discountAmount: { type: Number, required: true, min: 0 },
  }],
  rejectedCoupons: [{
    code: { type: String, required: true },
    reason: { type: String, required: true },
  }],
  requestPayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  qrCodeUrl: {
    type: String,
    default: null,
  },
  emv: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  paidAt: {
    type: Date,
    default: null,
  },
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
  errorMessage: {
    type: String,
    default: null,
  },
}, { timestamps: true });

coraPixChargeSchema.index({ client: 1, createdAt: -1 });

module.exports = mongoose.model('CoraPixCharge', coraPixChargeSchema);
