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
  messages: [messageSchema],
  // waiting = na fila | assigned = com operador | closed = encerrado
  status: { type: String, enum: ['waiting', 'assigned', 'closed'], default: 'waiting' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  queuedAt: { type: Date, default: Date.now },
  assignedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SupportChat', supportChatSchema);
