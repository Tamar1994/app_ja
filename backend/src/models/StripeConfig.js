const mongoose = require('mongoose');

// Singleton — apenas um documento controla o modo ativo
const stripeConfigSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ['test', 'production'],
    default: 'test',
  },
  updatedBy: { type: String, default: null },
}, { timestamps: true });

stripeConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) config = await this.create({});
  return config;
};

module.exports = mongoose.model('StripeConfig', stripeConfigSchema);
