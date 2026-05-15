const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const ServiceType = require('../models/ServiceType');
const { adminAuth } = require('../middleware/adminAuth');
const { cleanupRequestUploads, deleteUploadFile } = require('../utils/uploadCleanup');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers de parse
// ---------------------------------------------------------------------------

function parsePriceTiers(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue); } catch {
      throw Object.assign(new Error('priceTiers: JSON invalido'), { status: 400 });
    }
  }
  if (!Array.isArray(parsed)) throw Object.assign(new Error('priceTiers deve ser uma lista'), { status: 400 });

  return parsed.map((t, idx) => {
    const label = String(t?.label || '').trim();
    const durationMinutes = Number(t?.durationMinutes);
    const price = Number(t?.price);
    if (!label) throw Object.assign(new Error(`priceTiers[${idx}]: label e obrigatorio`), { status: 400 });
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) throw Object.assign(new Error(`priceTiers[${idx}]: durationMinutes invalido`), { status: 400 });
    if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error(`priceTiers[${idx}]: price invalido`), { status: 400 });
    const nightPriceRaw = t?.nightPrice;
    const nightPrice = (nightPriceRaw !== undefined && nightPriceRaw !== null && nightPriceRaw !== '')
      ? Number(nightPriceRaw)
      : null;
    if (nightPrice !== null && (!Number.isFinite(nightPrice) || nightPrice < 0)) throw Object.assign(new Error(`priceTiers[${idx}]: nightPrice invalido`), { status: 400 });
    return { label, durationMinutes, price, nightPrice, sortOrder: Number(t?.sortOrder ?? idx) };
  });
}

function parseUpsells(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue); } catch {
      throw Object.assign(new Error('upsells: JSON invalido'), { status: 400 });
    }
  }
  if (!Array.isArray(parsed)) throw Object.assign(new Error('upsells deve ser uma lista'), { status: 400 });

  const keys = new Set();
  return parsed.map((u, idx) => {
    const key = String(u?.key || '').trim().toLowerCase();
    const label = String(u?.label || '').trim();
    const price = Number(u?.price);
    if (!key) throw Object.assign(new Error(`upsells[${idx}]: key e obrigatorio`), { status: 400 });
    if (!label) throw Object.assign(new Error(`upsells[${idx}]: label e obrigatorio`), { status: 400 });
    if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error(`upsells[${idx}]: price invalido`), { status: 400 });
    if (keys.has(key)) throw Object.assign(new Error(`upsells: key duplicado "${key}"`), { status: 400 });
    keys.add(key);
    return { key, label, price, sortOrder: Number(u?.sortOrder ?? idx) };
  });
}

function parseOptionalNumber(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  const n = Number(rawValue);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Multer
// ---------------------------------------------------------------------------

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
    const allowed = ['.png', '.webp', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Envie um icone PNG, WEBP ou JPG'));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/service-types
router.get('/', async (req, res) => {
  try {
    const types = await ServiceType.find().sort({ sortOrder: 1, name: 1 });
    res.json({ serviceTypes: types });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar tipos de servico' });
  }
});

// POST /api/service-types
router.post('/', adminAuth, serviceTypeUpload.single('iconFile'), async (req, res) => {
  const { slug, name, description, icon, status, sortOrder, platformFeePercent } = req.body;
  if (!slug || !name) {
    await cleanupRequestUploads(req);
    return res.status(400).json({ message: 'slug e name sao obrigatorios' });
  }
  try {
    const priceTiers = parsePriceTiers(req.body.priceTiers) || [];
    const upsells    = parseUpsells(req.body.upsells) || [];
    const parsedPlatformFeePercent = parseOptionalNumber(platformFeePercent);
    const parsedNightRateStartHour = parseOptionalNumber(req.body.nightRateStartHour);
    const parsedNightRateEndHour = parseOptionalNumber(req.body.nightRateEndHour);

    if (parsedPlatformFeePercent !== undefined && (parsedPlatformFeePercent < 0 || parsedPlatformFeePercent > 100)) {
      return res.status(400).json({ message: 'platformFeePercent deve estar entre 0 e 100' });
    }
    if (parsedNightRateStartHour !== undefined && (parsedNightRateStartHour < 0 || parsedNightRateStartHour > 23)) {
      return res.status(400).json({ message: 'nightRateStartHour deve estar entre 0 e 23' });
    }
    if (parsedNightRateEndHour !== undefined && (parsedNightRateEndHour < 0 || parsedNightRateEndHour > 23)) {
      return res.status(400).json({ message: 'nightRateEndHour deve estar entre 0 e 23' });
    }

    const st = await ServiceType.create({
      slug,
      name,
      description: description || '',
      icon: icon || 'briefcase-outline',
      imageUrl: req.file ? `/uploads/service-types/${req.file.filename}` : null,
      status: status || 'disabled',
      sortOrder: sortOrder ?? 99,
      priceTiers,
      upsells,
      platformFeePercent: parsedPlatformFeePercent ?? 15,
      nightRateStartHour: parsedNightRateStartHour ?? null,
      nightRateEndHour: parsedNightRateStartHour != null
        ? (parsedNightRateEndHour ?? 6)
        : null,
      requiresLocationTracking: req.body.requiresLocationTracking === 'true',
    });
    res.status(201).json({ serviceType: st });
  } catch (err) {
    await cleanupRequestUploads(req);
    if (err.status === 400) return res.status(400).json({ message: err.message });
    if (err.code === 11000) return res.status(400).json({ message: 'Slug ja existe' });
    res.status(500).json({ message: 'Erro ao criar tipo de servico' });
  }
});

// PATCH /api/service-types/:id
router.patch('/:id', adminAuth, serviceTypeUpload.single('iconFile'), async (req, res) => {
  try {
    const existing = await ServiceType.findById(req.params.id).select('imageUrl');
    if (!existing) {
      await cleanupRequestUploads(req);
      return res.status(404).json({ message: 'Tipo nao encontrado' });
    }

    const updates = {};
    if (req.body.name        !== undefined) updates.name        = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.icon        !== undefined) updates.icon        = req.body.icon;
    if (req.body.status      !== undefined) updates.status      = req.body.status;
    if (req.body.sortOrder   !== undefined) updates.sortOrder   = Number(req.body.sortOrder);
    if (req.body.requiresLocationTracking !== undefined) {
      updates.requiresLocationTracking = req.body.requiresLocationTracking === 'true';
    }
    if (req.file) updates.imageUrl = `/uploads/service-types/${req.file.filename}`;

    const priceTiers = parsePriceTiers(req.body.priceTiers);
    const upsells    = parseUpsells(req.body.upsells);
    const parsedPlatformFeePercent = parseOptionalNumber(req.body.platformFeePercent);
    const parsedNightRateStartHour = req.body.nightRateStartHour !== undefined
      ? (req.body.nightRateStartHour === '' || req.body.nightRateStartHour === 'null' ? null : parseOptionalNumber(req.body.nightRateStartHour))
      : undefined;
    const parsedNightRateEndHour = req.body.nightRateEndHour !== undefined
      ? (req.body.nightRateEndHour === '' || req.body.nightRateEndHour === 'null' ? null : parseOptionalNumber(req.body.nightRateEndHour))
      : undefined;

    if (parsedPlatformFeePercent !== undefined) {
      if (parsedPlatformFeePercent < 0 || parsedPlatformFeePercent > 100) {
        return res.status(400).json({ message: 'platformFeePercent deve estar entre 0 e 100' });
      }
      updates.platformFeePercent = parsedPlatformFeePercent;
    }
    if (parsedNightRateStartHour !== undefined) {
      if (parsedNightRateStartHour !== null && (parsedNightRateStartHour < 0 || parsedNightRateStartHour > 23)) {
        return res.status(400).json({ message: 'nightRateStartHour deve estar entre 0 e 23' });
      }
      updates.nightRateStartHour = parsedNightRateStartHour;
      if (parsedNightRateStartHour === null) {
        updates.nightRateEndHour = null;
      } else if (parsedNightRateEndHour === undefined) {
        updates.nightRateEndHour = 6;
      }
    }
    if (parsedNightRateEndHour !== undefined) {
      if (parsedNightRateEndHour !== null && (parsedNightRateEndHour < 0 || parsedNightRateEndHour > 23)) {
        return res.status(400).json({ message: 'nightRateEndHour deve estar entre 0 e 23' });
      }
      updates.nightRateEndHour = parsedNightRateEndHour;
    }
    if (priceTiers !== undefined) updates.priceTiers = priceTiers;
    if (upsells !== undefined) updates.upsells = upsells;

    const st = await ServiceType.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (req.file && existing.imageUrl && existing.imageUrl !== st.imageUrl) {
      deleteUploadFile(existing.imageUrl).catch(() => {});
    }
    res.json({ serviceType: st });
  } catch (err) {
    await cleanupRequestUploads(req);
    if (err.status === 400) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: 'Erro ao atualizar tipo de servico' });
  }
});

// DELETE /api/service-types/:id
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const deleted = await ServiceType.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Tipo nao encontrado' });
    deleteUploadFile(deleted.imageUrl).catch(() => {});
    res.json({ message: 'Tipo removido' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao remover tipo de servico' });
  }
});

module.exports = router;
