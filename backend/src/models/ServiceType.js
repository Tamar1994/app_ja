const mongoose = require('mongoose');

const checkoutFieldOptionSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },
  priceImpact: { type: Number, default: 0 },
}, { _id: false });

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
