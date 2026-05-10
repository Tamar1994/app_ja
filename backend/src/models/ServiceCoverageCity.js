const mongoose = require('mongoose');

const serviceCoverageCitySchema = new mongoose.Schema({
  city: { type: String, required: true, trim: true },
  state: { type: String, required: false, trim: true, default: '' },
  normalizedCity: { type: String, required: true, index: true },
  normalizedState: { type: String, required: false, default: '', index: true },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

serviceCoverageCitySchema.index({ normalizedCity: 1, normalizedState: 1 }, { unique: true });

module.exports = mongoose.model('ServiceCoverageCity', serviceCoverageCitySchema);