const mongoose = require('mongoose');

const serviceTypeSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: 'briefcase-outline',
  },
  imageUrl: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['enabled', 'disabled'],
    default: 'disabled',
  },
  sortOrder: {
    type: Number,
    default: 99,
  },
}, { timestamps: true });

module.exports = mongoose.model('ServiceType', serviceTypeSchema);
