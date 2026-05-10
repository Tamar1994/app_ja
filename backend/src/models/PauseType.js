const mongoose = require('mongoose');

const pauseTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  durationMinutes: { type: Number, required: true, min: 1, max: 480 },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('PauseType', pauseTypeSchema);
