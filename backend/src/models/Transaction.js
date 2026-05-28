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
  // Quando o valor fica disponível para saque (PIX = imediato, cartão = +31 dias)
  availableAt: { type: Date, default: null },
  paymentMethod: {
    type: String,
    enum: ['pix', 'credit_card', 'wallet', null],
    default: null,
  },
  description: { type: String, default: '' },
}, { timestamps: true });

// Índice para calcular saldo disponível eficientemente
transactionSchema.index({ professional: 1, type: 1, availableAt: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
