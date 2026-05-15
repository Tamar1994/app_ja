const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const adBannerSchema = new Schema({
  title: { type: String, required: true, maxlength: 100 },
  imageUrl: { type: String, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  targetProfile: {
    type: String,
    enum: ['all', 'client', 'professional'],
    default: 'all',
  },
  active: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'AdminUser' },
}, { timestamps: true });

module.exports = mongoose.model('AdBanner', adBannerSchema);
