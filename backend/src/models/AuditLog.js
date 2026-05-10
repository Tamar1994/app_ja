const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  module: { type: String, default: 'general', index: true },
  action: { type: String, required: true, index: true },
  severity: { type: String, enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
  actorType: { type: String, enum: ['admin', 'user', 'system'], required: true },
  actorAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  message: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
