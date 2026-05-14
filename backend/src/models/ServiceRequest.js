const mongoose = require('mongoose');

const serviceRequestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  service: {
    type: String,
    enum: ['diarista'],
    default: 'diarista',
  },
  serviceTypeSlug: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['searching', 'accepted', 'preparing', 'on_the_way', 'in_progress', 'completed', 'cancelled'],
    default: 'searching',
  },
  address: {
    street: { type: String, required: true },
    neighborhood: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, default: '' },
    zipCode: { type: String, default: '' },
    complement: { type: String, default: '' },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
    },
  },
  details: {
    // Faixa horária escolhida pelo cliente (ex: "8h", "4h")
    tierLabel:       { type: String, default: null },
    durationMinutes: { type: Number, required: true, min: 1 }, // duração em minutos
    // Upsells selecionados pelo cliente
    upsells: {
      type: [{ key: String, label: String, price: Number }],
      default: [],
    },
    notes:         { type: String, default: '' },
    scheduledDate: { type: Date, required: true },
  },
  // true quando o cliente solicitou um Profissional Especialista
  isSpecialist: { type: Boolean, default: false },

  // Rastreamento de localização durante o serviço (herdado do ServiceType)
  requiresLocationTracking: { type: Boolean, default: false },

  // Fotos de comprovação enviadas pelo profissional ao concluir (visível apenas para admin/suporte)
  completionPhotos: { type: [String], default: [] },

  pricing: {
    tierPrice:      { type: Number, required: true },  // preço da faixa horária escolhida
    upsellsTotal:   { type: Number, default: 0 },       // soma dos upsells
    estimated:      { type: Number, required: true },   // tierPrice + upsellsTotal
    discountTotal:  { type: Number, default: 0 },
    appliedCoupons: [{ type: String }],
    customerTotal:  { type: Number, default: null },    // total após cupons
    customerPaidExternal:       { type: Number, default: 0 },
    walletAppliedTotal:         { type: Number, default: 0 },
    walletAppliedClient:        { type: Number, default: 0 },
    walletAppliedProfessional:  { type: Number, default: 0 },
    professionalBonus:          { type: Number, default: 0 },
    platformFeeDiscount:        { type: Number, default: 0 },
    professionalRewardCoupon:   { type: String, default: null },
    final:                      { type: Number, default: null },
    platformFeePercent:         { type: Number, default: 0 },  // % da plataforma (snapshot)
    platformFee:                { type: Number, default: 0 },  // valor R$ da taxa
  },
  payment: {
    status: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'failed'],
      default: 'pending',
    },
    method: { type: String, default: null },
    transactionId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundRequestedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: null },
    refundReason: { type: String, default: null },
    walletUsedAmount: { type: Number, default: 0 },
    refundDestination: { type: String, enum: ['gateway', 'wallet'], default: 'gateway' },
  },
  // Histórico de profissionais que recusaram
  rejectedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // Profissional atual que está sendo notificado (despacho por vez)
  currentAssignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  acceptedAt: { type: Date, default: null },
  clientConfirmedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  professionalPreparingAt: { type: Date, default: null },
  professionalOnTheWayAt: { type: Date, default: null },
  professionalLiveLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: null,
    },
  },
  professionalLiveLocationUpdatedAt: { type: Date, default: null },
}, { timestamps: true });

serviceRequestSchema.index({ 'address.coordinates': '2dsphere' });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
