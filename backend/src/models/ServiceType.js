const mongoose = require('mongoose');

// Faixa de preço por carga horária fixa
// Ex: { label: '8h', durationMinutes: 480, price: 180 }
const priceTierSchema = new mongoose.Schema({
  label:           { type: String, required: true, trim: true }, // ex: "8h", "4h", "30min"
  durationMinutes: { type: Number, required: true, min: 1 },     // duração em minutos
  price:           { type: Number, required: true, min: 0 },     // preço fixo em R$
  sortOrder:       { type: Number, default: 0 },
}, { _id: false });

// Upsell: adicional opcional que o cliente pode contratar junto
// Ex: { label: 'Levar produtos de limpeza', price: 40 }
const upsellSchema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true, lowercase: true }, // identificador único
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
  // Faixas de preço por duração fixa (novo modelo)
  priceTiers: {
    type: [priceTierSchema],
    default: [],
  },
  // Upsells opcionais (ex: levar produtos)
  upsells: {
    type: [upsellSchema],
    default: [],
  },
  // Taxa da plataforma em % (ex: 5 = 5%)
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

const checkoutFieldSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  label: {
    type: String,
    required: true,
    trim: true,
  },
  inputType: {
    type: String,
    enum: ['number', 'boolean', 'text', 'select'],
    required: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  placeholder: {
    type: String,
    default: '',
  },
  defaultValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  min: {
    type: Number,
    default: null,
  },
  max: {
    type: Number,
    default: null,
  },
  step: {
    type: Number,
    default: 1,
  },
  options: {
    type: [checkoutFieldOptionSchema],
    default: [],
  },
  pricingEnabled: {
    type: Boolean,
    default: false,
  },
  pricingMode: {
    type: String,
    enum: ['add_total', 'add_per_hour'],
    default: 'add_total',
  },
  pricingAmount: {
    type: Number,
    default: 0,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
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
  minHours: {
    type: Number,
    default: null,
  },
  maxHours: {
    type: Number,
    default: null,
  },
  hoursOptions: {
    type: [Number],
    default: [],
  },
  pricePerMinute: {
    type: Number,
    default: null,
  },
  platformFeePercent: {
    type: Number,
    default: null,
  },
  durationUnit: {
    type: String,
    enum: ['hours', 'minutes'],
    default: 'hours',
  },
  requiresLocationTracking: {
    type: Boolean,
    default: false,
  },
  checkoutFields: {
    type: [checkoutFieldSchema],
    default: [],
  },
}, { timestamps: true });

module.exports = mongoose.model('ServiceType', serviceTypeSchema);
