const mongoose = require('mongoose');

const priceTierSchema = new mongoose.Schema({
  label:           { type: String, required: true, trim: true },
  durationMinutes: { type: Number, required: true, min: 1 },
  price:           { type: Number, required: true, min: 0 },
  nightPrice:      { type: Number, default: null },
  sortOrder:       { type: Number, default: 0 },
}, { _id: false });

const upsellSchema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true, lowercase: true },
  label:     { type: String, required: true, trim: true },
  price:     { type: Number, required: true, min: 0 },
  sortOrder: { type: Number, default: 0 },
}, { _id: false });

const cityServiceConfigSchema = new mongoose.Schema({
  coverageCityId:     { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCoverageCity', required: true },
  city:               { type: String, required: true, trim: true },
  state:              { type: String, default: '', trim: true },
  normalizedCity:     { type: String, required: true, index: true },
  normalizedState:    { type: String, default: '', index: true },
  serviceTypeSlug:    { type: String, required: true, trim: true, lowercase: true },
  status:             { type: String, enum: ['enabled', 'disabled'], default: 'enabled' },
  priceTiers:         { type: [priceTierSchema], default: [] },
  upsells:            { type: [upsellSchema], default: [] },
  platformFeePercent: { type: Number, default: null, min: 0, max: 100 },
  nightRateStartHour: { type: Number, default: null, min: 0, max: 23 },
  nightRateEndHour:   { type: Number, default: null, min: 0, max: 23 },
}, { timestamps: true });

// Unique per (city, serviceType)
cityServiceConfigSchema.index({ coverageCityId: 1, serviceTypeSlug: 1 }, { unique: true });
// Quick lookup by normalizedCity+normalizedState
cityServiceConfigSchema.index({ normalizedCity: 1, normalizedState: 1 });

module.exports = mongoose.model('CityServiceConfig', cityServiceConfigSchema);
