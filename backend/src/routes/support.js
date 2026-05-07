const express = require('express');
const SupportChat = require('../models/SupportChat');
const auth = require('../middleware/auth');
const { tryAssignChat } = require('../utils/supportQueue');

const router = express.Router();

// POST /api/support/chats — cliente abre chamado de suporte
router.post('/chats', auth, async (req, res) => {
  const { subject } = req.body;
  if (!subject?.trim()) {
    return res.status(400).json({ message: 'Informe o assunto do atendimento' });
  }

  try {
    // Verificar se usuário já tem chat ativo
    const existing = await SupportChat.findOne({
      userId: req.user._id,
      status: { $in: ['waiting', 'assigned'] },
    });
    if (existing) {
      return res.status(400).json({
        message: 'Você já tem um atendimento em aberto',
        chatId: existing._id,
        status: existing.status,
      });
    }

    const chat = await SupportChat.create({
      userId: req.user._id,
      subject: subject.trim(),
      status: 'waiting',
      queuedAt: new Date(),
    });

    const io = req.app.get('io');
    const operator = await tryAssignChat(chat._id, io);

    const updated = await SupportChat.findById(chat._id);
    res.status(201).json({
      chatId: updated._id,
      status: updated.status,
      assignedTo: operator ? operator.name : null,
      message: operator
        ? 'Atendente disponível! Você será atendido em instantes.'
        : 'Você entrou na fila. Aguarde um atendente ficar disponível.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao abrir chamado' });
  }
});

// GET /api/support/chats/my — buscar chamado ativo do usuário
router.get('/chats/my', auth, async (req, res) => {
  try {
    const chat = await SupportChat.findOne({
      userId: req.user._id,
      status: { $in: ['waiting', 'assigned'] },
    }).populate('assignedTo', 'name');
    if (!chat) return res.json({ chat: null });
    res.json({ chat });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chamado' });
  }
});

// GET /api/support/chats/:id — detalhes de um chat
router.get('/chats/:id', auth, async (req, res) => {
  try {
    const chat = await SupportChat.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate('assignedTo', 'name');
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });
    res.json({ chat });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chat' });
  }
});

// POST /api/support/chats/:id/message — usuário envia mensagem
router.post('/chats/:id/message', auth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ message: 'Mensagem vazia' });
  try {
    const chat = await SupportChat.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: { $in: ['waiting', 'assigned'] },
    });
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

    chat.messages.push({ sender: 'user', text: text.trim() });
    await chat.save();

    // Notificar operador via socket (sala do operador)
    const io = req.app.get('io');
    if (io && chat.assignedTo) {
      io.to(`admin_${chat.assignedTo}`).emit('user_message', {
        chatId: chat._id,
        text: text.trim(),
        userName: req.user.name,
        userId: req.user._id,
      });
    }

    res.json({ message: 'Mensagem enviada' });
  } catch {
    res.status(500).json({ message: 'Erro ao enviar mensagem' });
  }
});

module.exports = router;
