const express = require('express');
const path = require('path');
const fs = require('fs');
const upload = require('../config/multer');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { validateCPF, isOver18 } = require('../utils/cpfValidator');
const { cleanupRequestUploads, deleteUploadFiles, deleteUploadFile } = require('../utils/uploadCleanup');

const router = express.Router();

// POST /api/upload/documents
// Envia selfie + frente do documento + verso do documento + comprovante de endereço + CPF + data nascimento
router.post('/documents', auth, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'residenceProof', maxCount: 1 },
]), async (req, res) => {
  try {
    const existingUser = await User.findById(req.user._id).select('cpf birthDate selfieUrl documentUrl documentBackUrl residenceProofUrl');

    // CPF e data de nascimento já foram salvos no cadastro
    const cpfClean = existingUser?.cpf || req.user.cpf;
    const birthDate = existingUser?.birthDate || req.user.birthDate;

    if (!cpfClean || !birthDate) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'CPF e data de nascimento não encontrados. Contate o suporte.' });
    }

    if (!validateCPF(cpfClean)) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'CPF inválido.' });
    }

    if (!isOver18(birthDate)) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'É necessário ter 18 anos ou mais para usar a plataforma.' });
    }

    // Verificar CPF duplicado (exceto o próprio usuário)
    const cpfExisting = await User.findOne({ cpf: cpfClean, _id: { $ne: req.user._id } });
    if (cpfExisting) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'CPF já cadastrado na plataforma.' });
    }

    if (!req.files?.selfie || !req.files?.document || !req.files?.documentBack) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'Envie a selfie, a frente e o verso do documento.' });
    }

    const isProfessional = req.user.userType === 'professional';

    // Comprovante de residência é obrigatório para profissionais
    if (isProfessional && !req.files?.residenceProof && !existingUser?.residenceProofUrl) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'Profissionais devem enviar o comprovante de residência.' });
    }

    const selfieUrl = `/uploads/${req.files.selfie[0].filename}`;
    const documentUrl = `/uploads/${req.files.document[0].filename}`;
    const documentBackUrl = `/uploads/${req.files.documentBack[0].filename}`;
    const residenceProofUrl = req.files?.residenceProof
      ? `/uploads/${req.files.residenceProof[0].filename}`
      : existingUser?.residenceProofUrl || null;

    const previousSelfieUrl = existingUser?.selfieUrl || null;
    const previousDocumentUrl = existingUser?.documentUrl || null;
    const previousDocumentBackUrl = existingUser?.documentBackUrl || null;

    // Todos aguardam revisão da equipe antes de usar a plataforma
    const newVerificationStatus = 'pending_review';

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        selfieUrl,
        documentUrl,
        documentBackUrl,
        residenceProofUrl,
        avatar: selfieUrl,
        verificationStatus: newVerificationStatus,
      },
      { new: true }
    ).select('selfieUrl documentUrl documentBackUrl residenceProofUrl avatar verificationStatus userType activeProfile name email');

    try {
      await deleteUploadFiles([previousSelfieUrl, previousDocumentUrl, previousDocumentBackUrl]);
    } catch (cleanupError) {
      console.error('Erro ao remover documentos antigos:', cleanupError);
    }

    const msg = isProfessional
      ? 'Documentos enviados com sucesso. Sua conta está em análise.'
      : 'Documentos enviados com sucesso!';
    res.json({ message: msg, user: updatedUser });
  } catch (err) {
    await cleanupRequestUploads(req);
    console.error(err);
    res.status(500).json({ message: 'Erro ao enviar documentos.' });
  }
});

// POST /api/upload/professional-upgrade
// Rota para CLIENTES que querem ativar o perfil profissional.
// O cliente já tem selfie/documento da verificação de cliente.
// Aqui ele envia apenas o comprovante de residência (+ endereço já salvo).
// Também suporta reenvio parcial de documentos quando solicitado pelo admin.
router.post('/professional-upgrade', auth, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'residenceProof', maxCount: 1 },
]), async (req, res) => {
  try {
    const existingUser = await User.findById(req.user._id).select(
      'userType professionalVerification professionalAddress selfieUrl documentUrl documentBackUrl residenceProofUrl cpf birthDate'
    );
    if (!existingUser) {
      await cleanupRequestUploads(req);
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Apenas clientes podem usar esse endpoint
    if (existingUser.userType !== 'client') {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'Endpoint exclusivo para clientes que ativam perfil profissional.' });
    }

    // Endereço profissional é obrigatório
    if (!existingUser.professionalAddress?.city) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'Cadastre o endereço profissional antes de enviar os documentos.' });
    }

    const pvStatus = existingUser.professionalVerification?.status || 'not_started';
    const isResubmit = pvStatus === 'resubmit_requested';
    const requiredDocs = isResubmit
      ? (existingUser.professionalVerification?.resubmitRequest?.requiredDocuments || [])
      : ['residenceProof']; // primeiro envio: só precisa do comprovante

    // Para reenvio: verificar se todos os docs solicitados foram enviados
    if (isResubmit) {
      const missing = requiredDocs.filter((doc) => {
        if (doc === 'residenceProof') return !req.files?.residenceProof && !existingUser.residenceProofUrl;
        if (doc === 'selfie') return !req.files?.selfie;
        if (doc === 'document') return !req.files?.document;
        if (doc === 'documentBack') return !req.files?.documentBack;
        return false;
      });
      if (missing.length > 0) {
        await cleanupRequestUploads(req);
        const labels = { selfie: 'Selfie', document: 'Doc. Frente', documentBack: 'Doc. Verso', residenceProof: 'Comprovante de Residência' };
        return res.status(400).json({ message: `Envie os documentos solicitados: ${missing.map((d) => labels[d] || d).join(', ')}.` });
      }
    } else {
      // Primeiro envio: comprovante de residência obrigatório
      if (!req.files?.residenceProof) {
        await cleanupRequestUploads(req);
        return res.status(400).json({ message: 'Envie o comprovante de residência.' });
      }
    }

    // Montar updates
    const updates = {};
    if (req.files?.selfie)          updates.selfieUrl        = `/uploads/${req.files.selfie[0].filename}`;
    if (req.files?.document)        updates.documentUrl      = `/uploads/${req.files.document[0].filename}`;
    if (req.files?.documentBack)    updates.documentBackUrl  = `/uploads/${req.files.documentBack[0].filename}`;
    if (req.files?.residenceProof)  updates.residenceProofUrl = `/uploads/${req.files.residenceProof[0].filename}`;

    updates['professionalVerification.status']      = 'pending_review';
    updates['professionalVerification.submittedAt'] = new Date();
    // Limpa pedido de reenvio se estava em resubmit_requested
    if (isResubmit) {
      updates['professionalVerification.resubmitRequest.requestedAt']       = null;
      updates['professionalVerification.resubmitRequest.message']           = '';
      updates['professionalVerification.resubmitRequest.requiredDocuments'] = [];
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    res.json({ message: 'Documentos enviados. Sua solicitação de perfil profissional está em análise.', user: updatedUser });
  } catch (err) {
    await cleanupRequestUploads(req);
    console.error('[professional-upgrade]', err);
    res.status(500).json({ message: 'Erro ao enviar documentos.' });
  }
});

// POST /api/upload/avatar — envia/atualiza foto de perfil
const avatarsDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const avatarUpload = require('multer')({
  storage: require('multer').diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const crypto = require('crypto');
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.post('/avatar', auth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Nenhuma imagem enviada.' });
    const existingUser = await User.findById(req.user._id).select('avatar');
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const previousAvatarUrl = existingUser?.avatar || null;
    await User.findByIdAndUpdate(req.user._id, { avatar: avatarUrl });
    try {
      await deleteUploadFile(previousAvatarUrl);
    } catch (cleanupError) {
      console.error('Erro ao remover avatar antigo:', cleanupError);
    }
    res.json({ message: 'Foto de perfil atualizada!', avatarUrl });
  } catch (err) {
    await cleanupRequestUploads(req);
    console.error(err);
    res.status(500).json({ message: 'Erro ao enviar foto de perfil.' });
  }
});

// POST /api/upload/residence-proof — comprovante de endereço (para cliente que adiciona perfil profissional)
// Aceita imagem ou PDF
const residenceUpload = require('multer')({
  storage: require('multer').diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const crypto = require('crypto');
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Apenas imagens ou PDF são permitidos'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post('/residence-proof', auth, residenceUpload.single('residenceProof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    const existingUser = await User.findById(req.user._id).select('residenceProofUrl');
    const residenceProofUrl = `/uploads/${req.file.filename}`;
    await User.findByIdAndUpdate(req.user._id, {
      residenceProofUrl,
      verificationStatus: 'pending_review',
    });
    try {
      if (existingUser?.residenceProofUrl) await deleteUploadFile(existingUser.residenceProofUrl);
    } catch {}
    res.json({ message: 'Comprovante enviado! Sua conta está em análise.', residenceProofUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao enviar comprovante.' });
  }
});

module.exports = router;
