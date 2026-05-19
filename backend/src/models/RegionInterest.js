const mongoose = require('mongoose');

const regionInterestSchema = new mongoose.Schema({
  city:        { type: String, trim: true, default: '' },
  state:       { type: String, trim: true, default: '' },
  coordinates: { type: [Number], default: null }, // [longitude, latitude]
  email:       { type: String, trim: true, lowercase: true, default: null },
  source:      { type: String, default: 'app' }, // 'app' | 'landing'
}, { timestamps: true });

// Índice esparso: e-mails únicos, mas registros sem e-mail não conflitam
regionInterestSchema.index({ email: 1 }, { sparse: true });
// Consultas por cidade para disparo de marketing
regionInterestSchema.index({ city: 1 });

module.exports = mongoose.model('RegionInterest', regionInterestSchema);
