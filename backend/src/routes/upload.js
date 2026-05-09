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
// Envia selfie + foto do documento + CPF + data nascimento
router.post('/documents', auth, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]), async (req, res) => {
  try {
    const existingUser = await User.findById(req.user._id).select('cpf birthDate selfieUrl documentUrl');

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

    if (!req.files?.selfie || !req.files?.document) {
      await cleanupRequestUploads(req);
      return res.status(400).json({ message: 'Envie a selfie e a foto do documento.' });
    }

    const selfieUrl = `/uploads/${req.files.selfie[0].filename}`;
    const documentUrl = `/uploads/${req.files.document[0].filename}`;
    const previousSelfieUrl = existingUser?.selfieUrl || null;
    const previousDocumentUrl = existingUser?.documentUrl || null;

    await User.findByIdAndUpdate(req.user._id, {
      selfieUrl,
      documentUrl,
      verificationStatus: 'pending_review',
    });

    try {
      await deleteUploadFiles([previousSelfieUrl, previousDocumentUrl]);
    } catch (cleanupError) {
      console.error('Erro ao remover documentos antigos:', cleanupError);
    }

    res.json({ message: 'Documentos enviados com sucesso. Sua conta está em análise.' });
  } catch (err) {
    await cleanupRequestUploads(req);
    console.error(err);
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

module.exports = router;
