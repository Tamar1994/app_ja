const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome é obrigatório'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'E-mail é obrigatório'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    required: [true, 'Telefone é obrigatório'],
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: 6,
    select: false,
  },
  userType: {
    type: String,
    enum: ['client', 'professional'],
    required: true,
  },
  avatar: {
    type: String,
    default: null,
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
    },
  },
  // Dados exclusivos do profissional
  professional: {
    bio: { type: String, default: '' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: false },
    pricePerHour: { type: Number, default: 35 },
    documentsVerified: { type: Boolean, default: false },
    totalServicesCompleted: { type: Number, default: 0 },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  cpf: {
    type: String,
    trim: true,
    default: null,
  },
  birthDate: {
    type: Date,
    default: null,
  },
  serviceTypeSlug: {
    type: String,
    default: null,
  },
  selfieUrl: {
    type: String,
    default: null,
  },
  documentUrl: {
    type: String,
    default: null,
  },
  // Carteira do profissional
  wallet: {
    balance: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
  },
  // pending_documents → pending_review → approved | rejected
  verificationStatus: {
    type: String,
    enum: ['pending_documents', 'pending_review', 'approved', 'rejected'],
    default: 'pending_documents',
  },
  rejectionReason: {
    type: String,
    default: null,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerificationCode: {
    type: String,
    select: false,
  },
  emailVerificationExpires: {
    type: Date,
    select: false,
  },
  // Token de push notification (Expo)
  pushToken: {
    type: String,
    default: null,
  },
}, { timestamps: true });

// Índice geoespacial para busca por proximidade
userSchema.index({ location: '2dsphere' });

// Hash da senha antes de salvar
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Método para comparar senhas
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
