const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const ServiceType = require('../models/ServiceType');
const { adminAuth } = require('../middleware/adminAuth');
const { cleanupRequestUploads, deleteUploadFile } = require('../utils/uploadCleanup');

const router = express.Router();

function parseCheckoutFields(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;

  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      const err = new Error('checkoutFields invalido (JSON mal formatado)');
      err.status = 400;
      throw err;
    }
  }

  if (!Array.isArray(parsed)) {
    const err = new Error('checkoutFields deve ser uma lista');
    err.status = 400;
    throw err;
  }

  const normalized = parsed.map((field, idx) => {
    const key = String(field?.key || '').trim().toLowerCase();
    const label = String(field?.label || '').trim();
    const inputType = String(field?.inputType || '').trim();
    const allowedTypes = new Set(['number', 'boolean', 'text', 'select']);

    if (!key || !label || !allowedTypes.has(inputType)) {
      const err = new Error(`Campo customizado invalido na posicao ${idx + 1}`);
      err.status = 400;
      throw err;
    }

    const options = Array.isArray(field.options)
      ? field.options
        .map((opt) => ({
          label: String(opt?.label || '').trim(),
          value: String(opt?.value || '').trim(),
          priceImpact: Number(opt?.priceImpact || 0),
        }))
        .filter((opt) => opt.label && opt.value)
      : [];

    return {
      key,
      label,
      inputType,
      required: Boolean(field.required),
      placeholder: String(field.placeholder || ''),
      defaultValue: field.defaultValue === undefined ? null : field.defaultValue,
      min: field.min === '' || field.min === null || field.min === undefined ? null : Number(field.min),
      max: field.max === '' || field.max === null || field.max === undefined ? null : Number(field.max),
      step: field.step === '' || field.step === null || field.step === undefined ? 1 : Number(field.step),
      options,
      pricingEnabled: Boolean(field.pricingEnabled),
      pricingMode: field.pricingMode === 'add_per_hour' ? 'add_per_hour' : 'add_total',
      pricingAmount: Number(field.pricingAmount || 0),
      sortOrder: Number(field.sortOrder || idx),
    };
  });

  const keySet = new Set();
  for (const field of normalized) {
    if (keySet.has(field.key)) {
      const err = new Error(`Chave duplicada em checkoutFields: ${field.key}`);
      err.status = 400;
      throw err;
    }
    keySet.add(field.key);
  }

  return normalized;
}

function parseOptionalNumber(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  const n = Number(rawValue);
  return Number.isFinite(n) ? n : undefined;
}

function parseHoursOptions(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;

  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      parsed = rawValue
        .split(',')
        .map((chunk) => Number(chunk.trim()))
        .filter((n) => Number.isFinite(n));
    }
  }

  if (!Array.isArray(parsed)) return undefined;

  const normalized = Array.from(new Set(parsed
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n))
  )).sort((a, b) => a - b);

  return normalized;
}

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
  const {
    slug,
    name,
    description,
    icon,
    status,
    sortOrder,
    minHours,
    maxHours,
    hoursOptions,
    pricePerMinute,
    platformFeePercent,
  } = req.body;
  if (!slug || !name) {
    await cleanupRequestUploads(req);
    return res.status(400).json({ message: 'slug e name são obrigatórios' });
  }
  try {
    const checkoutFields = parseCheckoutFields(req.body.checkoutFields);
    const parsedMinHours = parseOptionalNumber(minHours);
    const parsedMaxHours = parseOptionalNumber(maxHours);
    const parsedHoursOptions = parseHoursOptions(hoursOptions);
    const parsedPricePerMinute = parseOptionalNumber(pricePerMinute);
    const parsedPlatformFeePercent = parseOptionalNumber(platformFeePercent);

    if (parsedMinHours !== undefined && parsedMinHours < 1) {
      return res.status(400).json({ message: 'minHours deve ser maior ou igual a 1' });
    }
    if (parsedMaxHours !== undefined && parsedMaxHours < 1) {
      return res.status(400).json({ message: 'maxHours deve ser maior ou igual a 1' });
    }
    if (parsedMinHours !== undefined && parsedMaxHours !== undefined && parsedMinHours > parsedMaxHours) {
      return res.status(400).json({ message: 'minHours nao pode ser maior que maxHours' });
    }
    if (parsedPricePerMinute !== undefined && parsedPricePerMinute <= 0) {
      return res.status(400).json({ message: 'pricePerMinute deve ser maior que zero' });
    }
    if (parsedPlatformFeePercent !== undefined && (parsedPlatformFeePercent < 0 || parsedPlatformFeePercent > 100)) {
      return res.status(400).json({ message: 'platformFeePercent deve estar entre 0 e 100' });
    }

    const st = await ServiceType.create({
      slug,
      name,
      description,
      icon,
      imageUrl: req.file ? `/uploads/service-types/${req.file.filename}` : null,
      status: status || 'disabled',
      sortOrder: sortOrder ?? 99,
      ...(parsedMinHours !== undefined ? { minHours: parsedMinHours } : {}),
      ...(parsedMaxHours !== undefined ? { maxHours: parsedMaxHours } : {}),
      ...(parsedHoursOptions !== undefined ? { hoursOptions: parsedHoursOptions } : {}),
      ...(parsedPricePerMinute !== undefined ? { pricePerMinute: parsedPricePerMinute } : {}),
      ...(parsedPlatformFeePercent !== undefined ? { platformFeePercent: parsedPlatformFeePercent } : {}),
      ...(checkoutFields !== undefined ? { checkoutFields } : {}),
    });
    res.status(201).json({ serviceType: st });
  } catch (err) {
    await cleanupRequestUploads(req);
    if (err.status === 400) return res.status(400).json({ message: err.message });
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
    const checkoutFields = parseCheckoutFields(req.body.checkoutFields);
    const parsedMinHours = parseOptionalNumber(req.body.minHours);
    const parsedMaxHours = parseOptionalNumber(req.body.maxHours);
    const parsedHoursOptions = parseHoursOptions(req.body.hoursOptions);
    const parsedPricePerMinute = parseOptionalNumber(req.body.pricePerMinute);
    const parsedPlatformFeePercent = parseOptionalNumber(req.body.platformFeePercent);

    if (parsedMinHours !== undefined && parsedMinHours < 1) {
      return res.status(400).json({ message: 'minHours deve ser maior ou igual a 1' });
    }
    if (parsedMaxHours !== undefined && parsedMaxHours < 1) {
      return res.status(400).json({ message: 'maxHours deve ser maior ou igual a 1' });
    }
    if (parsedMinHours !== undefined && parsedMaxHours !== undefined && parsedMinHours > parsedMaxHours) {
      return res.status(400).json({ message: 'minHours nao pode ser maior que maxHours' });
    }
    if (parsedPricePerMinute !== undefined && parsedPricePerMinute <= 0) {
      return res.status(400).json({ message: 'pricePerMinute deve ser maior que zero' });
    }
    if (parsedPlatformFeePercent !== undefined && (parsedPlatformFeePercent < 0 || parsedPlatformFeePercent > 100)) {
      return res.status(400).json({ message: 'platformFeePercent deve estar entre 0 e 100' });
    }

    if (checkoutFields !== undefined) updates.checkoutFields = checkoutFields;
    if (parsedMinHours !== undefined) updates.minHours = parsedMinHours;
    if (parsedMaxHours !== undefined) updates.maxHours = parsedMaxHours;
    if (parsedHoursOptions !== undefined) updates.hoursOptions = parsedHoursOptions;
    if (parsedPricePerMinute !== undefined) updates.pricePerMinute = parsedPricePerMinute;
    if (parsedPlatformFeePercent !== undefined) updates.platformFeePercent = parsedPlatformFeePercent;
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
    if (err.status === 400) return res.status(400).json({ message: err.message });
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
