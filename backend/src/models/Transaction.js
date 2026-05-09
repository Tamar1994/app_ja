const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
  withdrawalRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WithdrawalRequest',
    default: null,
  },
  type: {
    type: String,
    enum: ['earning', 'withdrawal'],
    default: 'earning',
  },
  grossAmount: { type: Number, required: true },
  platformFee: { type: Number, required: true },
  amount: { type: Number, required: true }, // líquido (após taxa)
  status: {
    type: String,
    enum: ['available', 'withdrawn'],
    default: 'available',
  },
  description: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
