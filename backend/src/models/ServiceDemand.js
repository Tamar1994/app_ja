const mongoose = require('mongoose');

const ServiceDemandSchema = new mongoose.Schema(
  { prompt: { type: String, required: true, maxlength: 500 } },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceDemand', ServiceDemandSchema);
