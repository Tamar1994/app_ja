const express = require('express');
const ServiceType = require('../models/ServiceType');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

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
router.post('/', adminAuth, async (req, res) => {
  const { slug, name, description, icon, status, sortOrder } = req.body;
  if (!slug || !name) return res.status(400).json({ message: 'slug e name são obrigatórios' });
  try {
    const st = await ServiceType.create({ slug, name, description, icon, status: status || 'disabled', sortOrder: sortOrder ?? 99 });
    res.status(201).json({ serviceType: st });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Slug já existe' });
    res.status(500).json({ message: 'Erro ao criar tipo de serviço' });
  }
});

// PATCH /api/service-types/:id — atualizar (ex: mudar status enabled/disabled)
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const st = await ServiceType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!st) return res.status(404).json({ message: 'Tipo não encontrado' });
    res.json({ serviceType: st });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar tipo de serviço' });
  }
});

// DELETE /api/service-types/:id
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await ServiceType.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tipo removido' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao remover tipo de serviço' });
  }
});

module.exports = router;
