const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminUserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'support'],
    default: 'support',
  },
  isActive: { type: Boolean, default: true },
  permissions: {
    type: [String],
    default: [],
  },
  // Suporte ao vivo
  supportStatus: { type: String, enum: ['online', 'offline'], default: 'offline' },
  onlineAt: { type: Date, default: null },
  activeSupportChats: { type: Number, default: 0 },
}, { timestamps: true });

adminUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminUserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('AdminUser', adminUserSchema);
