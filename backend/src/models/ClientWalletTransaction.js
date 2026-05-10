const mongoose = require('mongoose');

const clientWalletTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
  type: {
    type: String,
    enum: ['debit_payment', 'credit_refund'],
    required: true,
  },
  source: {
    type: String,
    enum: ['client_wallet', 'professional_wallet', 'mixed', 'support_refund_wallet'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balanceAfterClientWallet: {
    type: Number,
    default: null,
  },
  balanceAfterProfessionalWallet: {
    type: Number,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

clientWalletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('ClientWalletTransaction', clientWalletTransactionSchema);
