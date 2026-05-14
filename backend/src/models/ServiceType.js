const mongoose = require('mongoose');

// Faixa de preco por carga horaria fixa
// Ex: { label: '8h', durationMinutes: 480, price: 180 }
const priceTierSchema = new mongoose.Schema({
  label:           { type: String, required: true, trim: true },
  durationMinutes: { type: Number, required: true, min: 1 },
  price:           { type: Number, required: true, min: 0 },
  sortOrder:       { type: Number, default: 0 },
}, { _id: false });

// Upsell: adicional opcional que o cliente pode contratar junto
const upsellSchema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true, lowercase: true },
  label:     { type: String, required: true, trim: true },
  price:     { type: Number, required: true, min: 0 },
  sortOrder: { type: Number, default: 0 },
}, { _id: false });

const serviceTypeSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: 'briefcase-outline',
  },
  imageUrl: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['enabled', 'disabled'],
    default: 'disabled',
  },
  sortOrder: {
    type: Number,
    default: 99,
  },
  priceTiers: {
    type: [priceTierSchema],
    default: [],
  },
  upsells: {
    type: [upsellSchema],
    default: [],
  },
  platformFeePercent: {
    type: Number,
    default: 15,
    min: 0,
    max: 100,
  },
  requiresLocationTracking: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('ServiceType', serviceTypeSchema);
