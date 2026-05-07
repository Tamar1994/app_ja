const express = require('express');
const path = require('path');
const upload = require('../config/multer');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { validateCPF, isOver18 } = require('../utils/cpfValidator');

const router = express.Router();

// POST /api/upload/documents
// Envia selfie + foto do documento + CPF + data nascimento
router.post('/documents', auth, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]), async (req, res) => {
  try {
    // CPF e data de nascimento já foram salvos no cadastro
    const cpfClean = req.user.cpf;
    const birthDate = req.user.birthDate;

    if (!cpfClean || !birthDate) {
      return res.status(400).json({ message: 'CPF e data de nascimento não encontrados. Contate o suporte.' });
    }

    if (!validateCPF(cpfClean)) {
      return res.status(400).json({ message: 'CPF inválido.' });
    }

    if (!isOver18(birthDate)) {
      return res.status(400).json({ message: 'É necessário ter 18 anos ou mais para usar a plataforma.' });
    }

    // Verificar CPF duplicado (exceto o próprio usuário)
    const cpfExisting = await User.findOne({ cpf: cpfClean, _id: { $ne: req.user._id } });
    if (cpfExisting) {
      return res.status(400).json({ message: 'CPF já cadastrado na plataforma.' });
    }

    if (!req.files?.selfie || !req.files?.document) {
      return res.status(400).json({ message: 'Envie a selfie e a foto do documento.' });
    }

    const selfieUrl = `/uploads/${req.files.selfie[0].filename}`;
    const documentUrl = `/uploads/${req.files.document[0].filename}`;

    await User.findByIdAndUpdate(req.user._id, {
      selfieUrl,
      documentUrl,
      verificationStatus: 'pending_review',
    });

    res.json({ message: 'Documentos enviados com sucesso. Sua conta está em análise.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao enviar documentos.' });
  }
});

module.exports = router;
