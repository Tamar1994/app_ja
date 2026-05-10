const mongoose = require('mongoose');

/**
 * SpecialistCertificate — certificado enviado pelo profissional para validação pelo admin.
 * Quando aprovado, o admin define um `adminNote` (título de especialização) que aparece
 * para os clientes na tela de confirmação do profissional.
 */
const schema = new mongoose.Schema({
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Arquivo enviado pelo profissional (imagem ou PDF convertido para imagem)
  fileUrl: {
    type: String,
    required: true,
  },
  // Título alegado pelo profissional ("Limpeza de piscinas", "Serviços elétricos", etc.)
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  // Descrição opcional do profissional
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  // Status de revisão
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  // Título de especialização definido pelo admin (exibido para clientes)
  // Ex: "Especialista em Limpeza de Piscinas"
  adminNote: {
    type: String,
    trim: true,
    maxlength: 120,
    default: '',
  },
  rejectionReason: {
    type: String,
    trim: true,
    maxlength: 300,
    default: '',
  },
  reviewedAt: {
    type: Date,
    default: null,
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('SpecialistCertificate', schema);
