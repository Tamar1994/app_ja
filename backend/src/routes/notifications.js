const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const auth    = require('../middleware/auth');
const PushNotification = require('../models/PushNotification');

// Retorna filtro de audiência baseado no perfil ativo do usuário
function buildAudienceFilter(user) {
  const profile = user.activeProfile || user.userType; // 'client' | 'professional'
  return profile === 'professional'
    ? { audience: { $in: ['all', 'professionals'] } }
    : { audience: { $in: ['all', 'clients'] } };
}

// GET /api/notifications/unread-count — contagem rápida para o badge
// Deve ficar ANTES de /:id para não ser capturado como parâmetro
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await PushNotification.countDocuments({
      ...buildAudienceFilter(req.user),
      readBy: { $ne: req.user._id },
    });
    res.json({ count });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar contagem de notificações' });
  }
});

// POST /api/notifications/read-all — marca todas as notificações relevantes como lidas
// Deve ficar ANTES de /:id/read para não ser capturado como parâmetro
router.post('/read-all', auth, async (req, res) => {
  try {
    await PushNotification.updateMany(
      {
        ...buildAudienceFilter(req.user),
        readBy: { $ne: req.user._id },
      },
      { $addToSet: { readBy: req.user._id } },
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'Erro ao marcar notificações como lidas' });
  }
});

// GET /api/notifications — lista paginada de notificações do usuário
router.get('/', auth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = buildAudienceFilter(req.user);
    const notifications = await PushNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('title body data createdAt readBy')
      .lean();

    const userId = req.user._id.toString();
    const result = notifications.map(n => ({
      _id:     n._id,
      title:   n.title,
      body:    n.body,
      data:    n.data,
      createdAt: n.createdAt,
      isRead:  n.readBy.some(id => id.toString() === userId),
    }));

    res.json({ notifications: result, page, limit });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar notificações' });
  }
});

// POST /api/notifications/:id/read — marca uma notificação específica como lida
router.post('/:id/read', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'ID inválido' });
  }
  try {
    await PushNotification.updateOne(
      { _id: req.params.id },
      { $addToSet: { readBy: req.user._id } },
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'Erro ao marcar notificação como lida' });
  }
});

module.exports = router;
