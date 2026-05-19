const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  street:       { type: String, default: '' },
  neighborhood: { type: String, default: '' },
  city:         { type: String, default: '' },
  state:        { type: String, default: '' },
  zipCode:      { type: String, default: '' },
  complement:   { type: String, default: '' },
}, { _id: false });

const addressUpdateRequestSchema = new mongoose.Schema({
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  oldAddress: { type: addressSchema, required: true },
  newAddress: { type: addressSchema, required: true },
  proofUrl: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  reviewedBy:     { type: String, default: null },
  reviewedAt:     { type: Date,   default: null },
  rejectionReason:{ type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AddressUpdateRequest', addressUpdateRequestSchema);
