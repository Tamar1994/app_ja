const express = require('express');
const HelpTopic = require('../models/HelpTopic');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/help — tópicos ativos com itens (móvel + web público)
router.get('/', async (req, res) => {
  try {
    const topics = await HelpTopic.find({ isActive: true })
      .select('title description icon sortOrder items')
      .sort({ sortOrder: 1, title: 1 });
    res.json({ topics });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar tópicos de ajuda' });
  }
});

// POST /api/help/items/:itemId/rate — avaliar um item (usuário autenticado)
router.post('/items/:itemId/rate', auth, async (req, res) => {
  const { helpful } = req.body;
  if (typeof helpful !== 'boolean') {
    return res.status(400).json({ message: 'Campo "helpful" (boolean) é obrigatório' });
  }
  try {
    const field = helpful ? 'items.$.ratings.helpful' : 'items.$.ratings.notHelpful';
    const topic = await HelpTopic.findOneAndUpdate(
      { 'items._id': req.params.itemId },
      { $inc: { [field]: 1 } },
      { new: true }
    );
    if (!topic) return res.status(404).json({ message: 'Item não encontrado' });
    const item = topic.items.id(req.params.itemId);
    res.json({ ratings: item.ratings });
  } catch {
    res.status(500).json({ message: 'Erro ao registrar avaliação' });
  }
});

module.exports = router;
