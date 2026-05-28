'use strict';
const mongoose = require('mongoose');

/**
 * AsaasPayment — representa uma cobrança criada no Asaas.
 * Gerada no momento em que o cliente inicia o pagamento (PIX ou cartão).
 * Após confirmação do pagamento, um ServiceRequest é criado e vinculado.
 */
const asaasPaymentSchema = new mongoose.Schema(
  {
    // ── Referência ao cliente ────────────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── IDs do Asaas ─────────────────────────────────────────────────────────
    asaasPaymentId: { type: String, required: true, index: true }, // pay_xxx
    asaasCustomerId: { type: String, default: null },              // cus_xxx

    // ── Método e status ───────────────────────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ['pix', 'credit_card'],
      required: true,
    },
    status: {
      type: String,
      // Asaas statuses mapeados: PENDING → pending, CONFIRMED/RECEIVED → paid, OVERDUE → expired
      enum: ['pending', 'paid', 'expired', 'refunded', 'failed'],
      default: 'pending',
    },
    asaasStatus: { type: String, default: null }, // status raw do Asaas (PENDING, CONFIRMED, etc.)

    // ── Valores ───────────────────────────────────────────────────────────────
    amount: { type: Number, required: true },        // total cobrado em R$
    subtotal: { type: Number, default: 0 },           // antes descontos
    discountTotal: { type: Number, default: 0 },
    walletAppliedTotal: { type: Number, default: 0 },
    walletAppliedClient: { type: Number, default: 0 },
    walletAppliedProfessional: { type: Number, default: 0 },

    // ── Cupons ────────────────────────────────────────────────────────────────
    appliedCoupons: [{
      code: String,
      discountAmount: Number,
    }],
    rejectedCoupons: [{ type: mongoose.Schema.Types.Mixed }],

    // ── PIX ───────────────────────────────────────────────────────────────────
    pixPayload: { type: String, default: null },       // EMV (copia e cola)
    pixEncodedImage: { type: String, default: null },  // base64 PNG
    pixExpiresAt: { type: Date, default: null },

    // ── Cartão ────────────────────────────────────────────────────────────────
    cardLastFour: { type: String, default: null },
    cardBrand: { type: String, default: null },

    // ── Pedido vinculado (preenchido após pagamento confirmado) ───────────────
    serviceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    // ── Payload original do pedido ────────────────────────────────────────────
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Parcelamento (cartão) ─────────────────────────────────────────────────
    installments: { type: Number, default: 1 },

    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// índice composto para polling de status
asaasPaymentSchema.index({ asaasPaymentId: 1, status: 1 });
asaasPaymentSchema.index({ client: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AsaasPayment', asaasPaymentSchema);
