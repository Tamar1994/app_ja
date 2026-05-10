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
    hours: { type: Number, required: true, min: 2, max: 12 },
    rooms: { type: Number, default: 1 },
    bathrooms: { type: Number, default: 1 },
    hasProducts: { type: Boolean, default: false }, // cliente fornece produtos
    customFormData: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    customFormSummary: {
      type: [{
        key: { type: String },
        label: { type: String },
        inputType: { type: String },
        value: mongoose.Schema.Types.Mixed,
        displayValue: { type: String },
      }],
      default: [],
    },
    notes: { type: String, default: '' },
    scheduledDate: { type: Date, required: true },
  },
  // true quando o cliente solicitou um Profissional Especialista
  isSpecialist: { type: Boolean, default: false },

  pricing: {
    pricePerHour: { type: Number, required: true },
    estimated: { type: Number, required: true }, // valor bruto do servico (base para repasse do profissional)
    specialistPremium: { type: Number, default: 0 }, // acrescimo por ser pedido especialista
    discountTotal: { type: Number, default: 0 },
    appliedCoupons: [{ type: String }],
    customerTotal: { type: Number, default: null }, // total apos cupons
    customerPaidExternal: { type: Number, default: 0 }, // valor efetivamente pago via gateway externo
    walletAppliedTotal: { type: Number, default: 0 },
    walletAppliedClient: { type: Number, default: 0 },
    walletAppliedProfessional: { type: Number, default: 0 },
    professionalBonus: { type: Number, default: 0 },
    platformFeeDiscount: { type: Number, default: 0 },
    professionalRewardCoupon: { type: String, default: null },
    final: { type: Number, default: null },
    platformFee: { type: Number, default: 0 }, // taxa da plataforma (%)
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
