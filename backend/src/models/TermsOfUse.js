const mongoose = require('mongoose');

const termsSchema = new mongoose.Schema({
  content: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

// Sempre singleton — retorna ou cria o único documento
termsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({ content: '' });
  return doc;
};

module.exports = mongoose.model('TermsOfUse', termsSchema);
