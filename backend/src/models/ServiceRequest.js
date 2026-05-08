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
  status: {
    type: String,
    enum: ['searching', 'accepted', 'in_progress', 'completed', 'cancelled'],
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
    notes: { type: String, default: '' },
    scheduledDate: { type: Date, required: true },
  },
  pricing: {
    pricePerHour: { type: Number, required: true },
    estimated: { type: Number, required: true },
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
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: null },
}, { timestamps: true });

serviceRequestSchema.index({ 'address.coordinates': '2dsphere' });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
