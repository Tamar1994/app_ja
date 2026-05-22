const mongoose = require('mongoose');

// Fila de estornos via PIX para cancelamentos onde o cliente pagou via PIX
// e solicitou reembolso na forma de pagamento original.
// O admin processa manualmente e marca como concluído.

const pixRefundRequestSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true,
    index: true,
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Valor a ser estornado (somente parcela paga externamente, já descontada a taxa)
  amount: { type: Number, required: true, min: 0 },

  // Chave PIX do cliente para o estorno (usada pelo admin ao fazer o PIX manual)
  pixKey:     { type: String, default: null },
  pixKeyType: { type: String, enum: ['cpf', 'phone', 'email', 'random', null], default: null },

  // Referência da cobrança original Cora (para consulta)
  pixChargeId: { type: String, default: null },

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },

  processedAt: { type: Date, default: null },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  internalNote: { type: String, default: '' },
  transferProofUrl: { type: String, default: null },

  // Snapshot da taxa de cancelamento aplicada
  cancelFeeSnapshot: {
    phaseName:              { type: String, default: '' },
    totalFeePercent:        { type: Number, default: 0 },
    platformFeePercent:     { type: Number, default: 0 },
    professionalFeePercent: { type: Number, default: 0 },
    feeAmount:              { type: Number, default: 0 },
    totalPaid:              { type: Number, default: 0 },
  },
}, { timestamps: true });

pixRefundRequestSchema.index({ client: 1, createdAt: -1 });

module.exports = mongoose.model('PixRefundRequest', pixRefundRequestSchema);
