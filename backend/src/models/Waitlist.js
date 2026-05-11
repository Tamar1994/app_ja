const mongoose = require('mongoose');

const waitlistSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, required: true, lowercase: true, trim: true },
  source: { type: String, default: 'landing' },
  createdAt: { type: Date, default: Date.now },
});

waitlistSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('Waitlist', waitlistSchema);
