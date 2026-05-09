const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  pixKeyCpfSnapshot: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  requestedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  processedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    default: null,
  },
  internalNote: {
    type: String,
    default: '',
  },
  transferProofUrl: {
    type: String,
    default: null,
  },
  transferProofUploadedAt: {
    type: Date,
    default: null,
  },
  transferProofUploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    default: null,
  },
}, { timestamps: true });

withdrawalRequestSchema.index({ professional: 1, requestedAt: -1 });

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
