const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['client', 'professional'], required: true },
  text: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const serviceChatSchema = new mongoose.Schema({
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true,
    unique: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  professionalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
  },
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active',
  },
  closedAt: {
    type: Date,
    default: null,
  },
  closedReason: {
    type: String,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('ServiceChat', serviceChatSchema);
