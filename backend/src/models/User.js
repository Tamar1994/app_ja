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
  profileModes: {
    client: {
      type: Boolean,
      default: function profileClientDefault() {
        return this.userType === 'client';
      },
    },
    professional: {
      type: Boolean,
      default: function profileProfessionalDefault() {
        return this.userType === 'professional';
      },
    },
  },
  activeProfile: {
    type: String,
    enum: ['client', 'professional'],
    default: function activeProfileDefault() {
      return this.userType || 'client';
    },
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
    // Especialista — true quando possui ao menos 1 certificado aprovado pelo admin
    isSpecialist: { type: Boolean, default: false },
    // Especializações aprovadas (títulos visíveis ao cliente)
    specializations: [
      {
        title: { type: String, trim: true },         // Texto atribuído pelo admin
        certificateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialistCertificate' },
        grantedAt: { type: Date, default: Date.now },
      },
    ],
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
  documentBackUrl: {
    type: String,
    default: null,
  },
  residenceProofUrl: {
    type: String,
    default: null,
  },
  // Carteira do profissional (ganhos)
  wallet: {
    balance: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
  },
  // Carteira do cliente (creditos / estornos)
  clientWallet: {
    balance: { type: Number, default: 0 },
    totalRefunded: { type: Number, default: 0 },
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
  // Stripe Customer ID (para carteira de pagamentos)
  stripeCustomerId: {
    type: String,
    default: null,
  },
}, { timestamps: true });

// Índice geoespacial para busca por proximidade
userSchema.index({ location: '2dsphere' });

// Inicializar profileModes e activeProfile se necessário
userSchema.pre('save', function (next) {
  if (!this.profileModes || (this.profileModes.client === undefined && this.profileModes.professional === undefined)) {
    this.profileModes = {
      client: this.userType === 'client',
      professional: this.userType === 'professional',
    };
  }

  if (!this.activeProfile) {
    this.activeProfile = this.userType || 'client';
  }

  next();
});

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
