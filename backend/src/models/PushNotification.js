const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const pushNotificationSchema = new Schema({
  title:    { type: String, required: true },
  body:     { type: String, required: true },
  audience: { type: String, enum: ['all', 'clients', 'professionals'], required: true },
  data:     { type: Schema.Types.Mixed, default: {} },
  sentBy:   { type: ObjectId, ref: 'AdminUser' },
  readBy:   [{ type: ObjectId, ref: 'User' }],
}, { timestamps: true });

pushNotificationSchema.index({ audience: 1, createdAt: -1 });

module.exports = mongoose.model('PushNotification', pushNotificationSchema);
