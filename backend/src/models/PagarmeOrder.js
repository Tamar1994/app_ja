const mongoose = require('mongoose');

const pagarmeOrderSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Pagar.me order ID: "or_..."
  pagarmeOrderId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  // Pagar.me charge ID: "ch_..."
  pagarmeChargeId: {
    type: String,
    default: null,
    trim: true,
  },
  paymentMethod: {
    type: String,
    enum: ['pix', 'credit_card'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'cancelled', 'expired'],
    default: 'pending',
    index: true,
  },
  // Valor em reais cobrado via Pagar.me (após deduções de carteira)
  amount: {
    type: Number,
    required: true,
  },
  // Valor em centavos enviado ao Pagar.me
  amountCents: {
    type: Number,
    required: true,
  },
  // Subtotal bruto do serviço antes de descontos e carteira
  subtotal: {
    type: Number,
    required: true,
  },
  discountTotal: { type: Number, default: 0 },
  walletAppliedTotal: { type: Number, default: 0 },
  walletAppliedClient: { type: Number, default: 0 },
  walletAppliedProfessional: { type: Number, default: 0 },
  appliedCoupons: [{
    code: { type: String, required: true },
    discountAmount: { type: Number, required: true, min: 0 },
  }],
  rejectedCoupons: [{
    code: { type: String, required: true },
    reason: { type: String, required: true },
  }],
  // Payload completo para recriar o ServiceRequest ao confirmar pagamento
  requestPayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  // PIX — dados do QR code
  pixEmv: { type: String, default: null },
  pixQrCodeUrl: { type: String, default: null },
  pixExpiresAt: { type: Date, default: null },
  // Split — IDs dos recebedores usados na transação
  platformRecipientId: { type: String, default: null },
  professionalRecipientId: { type: String, default: null },
  splitApplied: { type: Boolean, default: false },
  // Confirmação
  paidAt: { type: Date, default: null },
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('PagarmeOrder', pagarmeOrderSchema);
