const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const ServiceType = require('../models/ServiceType');
const { adminAuth } = require('../middleware/adminAuth');
const { cleanupRequestUploads, deleteUploadFile } = require('../utils/uploadCleanup');

const router = express.Router();

const serviceTypeUploadsDir = path.join(__dirname, '../../uploads/service-types');
if (!fs.existsSync(serviceTypeUploadsDir)) fs.mkdirSync(serviceTypeUploadsDir, { recursive: true });

const serviceTypeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, serviceTypeUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Envie um ícone PNG ou WEBP com fundo transparente'));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// GET /api/service-types — lista pública (mobile usa para mostrar profissões)
router.get('/', async (req, res) => {
  try {
    const types = await ServiceType.find().sort({ sortOrder: 1, name: 1 });
    res.json({ serviceTypes: types });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar tipos de serviço' });
  }
});

// As rotas abaixo são exclusivas do admin

// POST /api/service-types — criar tipo
router.post('/', adminAuth, serviceTypeUpload.single('iconFile'), async (req, res) => {
  const { slug, name, description, icon, status, sortOrder } = req.body;
  if (!slug || !name) {
    await cleanupRequestUploads(req);
    return res.status(400).json({ message: 'slug e name são obrigatórios' });
  }
  try {
    const st = await ServiceType.create({
      slug,
      name,
      description,
      icon,
      imageUrl: req.file ? `/uploads/service-types/${req.file.filename}` : null,
      status: status || 'disabled',
      sortOrder: sortOrder ?? 99,
    });
    res.status(201).json({ serviceType: st });
  } catch (err) {
    await cleanupRequestUploads(req);
    if (err.code === 11000) return res.status(400).json({ message: 'Slug já existe' });
    res.status(500).json({ message: 'Erro ao criar tipo de serviço' });
  }
});

// PATCH /api/service-types/:id — atualizar (ex: mudar status enabled/disabled)
router.patch('/:id', adminAuth, serviceTypeUpload.single('iconFile'), async (req, res) => {
  try {
    const existingServiceType = await ServiceType.findById(req.params.id).select('imageUrl');
    if (!existingServiceType) {
      await cleanupRequestUploads(req);
      return res.status(404).json({ message: 'Tipo não encontrado' });
    }

    const updates = { ...req.body };
    if (req.file) updates.imageUrl = `/uploads/service-types/${req.file.filename}`;
    const st = await ServiceType.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (req.file && existingServiceType.imageUrl && existingServiceType.imageUrl !== st.imageUrl) {
      try {
        await deleteUploadFile(existingServiceType.imageUrl);
      } catch (cleanupError) {
        console.error('Erro ao remover ícone antigo do serviço:', cleanupError);
      }
    }
    res.json({ serviceType: st });
  } catch (err) {
    await cleanupRequestUploads(req);
    res.status(500).json({ message: 'Erro ao atualizar tipo de serviço' });
  }
});

// DELETE /api/service-types/:id
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const deletedServiceType = await ServiceType.findByIdAndDelete(req.params.id);
    if (!deletedServiceType) return res.status(404).json({ message: 'Tipo não encontrado' });
    try {
      await deleteUploadFile(deletedServiceType.imageUrl);
    } catch (cleanupError) {
      console.error('Erro ao remover ícone do serviço excluído:', cleanupError);
    }
    res.json({ message: 'Tipo removido' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao remover tipo de serviço' });
  }
});

module.exports = router;
