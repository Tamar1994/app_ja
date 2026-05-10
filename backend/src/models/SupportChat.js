const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'support'], required: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const supportChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, default: '' },
  priority: { type: String, enum: ['normal', 'p1'], default: 'normal' },
  priorityLevel: { type: Number, default: 0, index: true },
  category: { type: String, default: 'general' },
  emergencyContext: { type: String, default: '' },
  relatedServiceRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', default: null },
  messages: [messageSchema],
  // waiting = na fila | assigned = com operador | closed = encerrado
  status: { type: String, enum: ['waiting', 'assigned', 'closed'], default: 'waiting' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  queuedAt: { type: Date, default: Date.now },
  assignedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SupportChat', supportChatSchema);
