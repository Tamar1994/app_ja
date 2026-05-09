const mongoose = require('mongoose');

// Documento singleton — sempre um único registro
const pricingConfigSchema = new mongoose.Schema({
  basePricePerHour: { type: Number, required: true, default: 35 },
  serviceBasePrices: {
    type: Map,
    of: Number,
    default: {},
  },
  platformFeePercent: { type: Number, required: true, default: 15 },
  productsSurcharge: { type: Number, required: true, default: 5 }, // R$/h quando profissional traz produtos
  minHours: { type: Number, required: true, default: 2 },
  maxHours: { type: Number, required: true, default: 12 },
  hoursOptions: { type: [Number], default: [2, 3, 4, 5, 6, 8] },
}, { timestamps: true });

pricingConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);
