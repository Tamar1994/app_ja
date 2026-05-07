const mongoose = require('mongoose');

const helpItemSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
  ratings: {
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
  },
}, { timestamps: true });

const helpTopicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '❓' },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  items: [helpItemSchema],
}, { timestamps: true });

module.exports = mongoose.model('HelpTopic', helpTopicSchema);
