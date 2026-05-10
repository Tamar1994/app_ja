const express = require('express');
const path = require('path');
const auth = require('../middleware/auth');
const SpecialistCertificate = require('../models/SpecialistCertificate');
const { uploadWithPdf } = require('../config/multer');

const router = express.Router();

// POST /api/specialist-certificates — enviar certificado para validação
router.post('/', auth, uploadWithPdf.single('certificate'), async (req, res) => {
  if (req.user.userType !== 'professional' && !req.user.profileModes?.professional) {
    return res.status(403).json({ message: 'Apenas profissionais podem enviar certificados.' });
  }

  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Informe o título/área do certificado.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'Envie o arquivo do certificado (imagem ou PDF).' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;

  const cert = await SpecialistCertificate.create({
    professional: req.user._id,
    fileUrl,
    title: title.trim(),
    description: description ? description.trim() : '',
    status: 'pending',
  });

  res.status(201).json({
    message: 'Certificado enviado para análise.',
    certificate: cert,
  });
});

// GET /api/specialist-certificates/my — listar meus certificados
router.get('/my', auth, async (req, res) => {
  const certs = await SpecialistCertificate.find({ professional: req.user._id })
    .sort({ createdAt: -1 });
  res.json({ certificates: certs });
});

module.exports = router;
