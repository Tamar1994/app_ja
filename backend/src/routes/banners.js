const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const AdBanner = require('../models/AdBanner');

// GET /api/banners/active — retorna o banner ativo para o usuário autenticado
router.get('/active', auth, async (req, res) => {
  try {
    const now = new Date();
    const banner = await AdBanner.findOne({
      active: true,
      startAt: { $lte: now },
      endAt: { $gte: now },
      targetProfile: { $in: ['all', req.user.userType] },
    }).sort({ startAt: -1 }).lean();

    res.json({ banner: banner || null });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar banner' });
  }
});

module.exports = router;
