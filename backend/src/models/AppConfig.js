const mongoose = require('mongoose');

// Singleton — um único documento controla as flags de cadastro do app
const appConfigSchema = new mongoose.Schema({
  allowClientRegistration:       { type: Boolean, default: false },
  allowProfessionalRegistration: { type: Boolean, default: true  },
  updatedBy: { type: String, default: null },
}, { timestamps: true });

appConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) config = await this.create({});
  return config;
};

module.exports = mongoose.model('AppConfig', appConfigSchema);
