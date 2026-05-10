const express = require('express');
const SupportChat = require('../models/SupportChat');
const auth = require('../middleware/auth');
const upload = require('../config/multer');
const { tryAssignChat } = require('../utils/supportQueue');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

function emitP1Alert(io, chat, user) {
  if (!io || !chat || chat.priority !== 'p1') return;
  io.to('support_ops').emit('support_p1_alert', {
    type: 'support_p1_alert',
    chatId: chat._id,
    userName: user?.name || 'Profissional',
    subject: chat.subject,
    emergencyContext: chat.emergencyContext || '',
    relatedServiceRequestId: chat.relatedServiceRequestId || null,
    queuedAt: chat.queuedAt || new Date(),
  });
}

function resolvePriorityPayload(user, body = {}) {
  const isProfessional = user?.userType === 'professional';
  const wantsP1 = body.priority === 'p1' || body.category === 'emergency' || body.isEmergency === true;
  if (!isProfessional || !wantsP1) {
    return {
      priority: 'normal',
      priorityLevel: 0,
      category: String(body.category || 'general').trim() || 'general',
      emergencyContext: '',
      relatedServiceRequestId: null,
    };
  }

  return {
    priority: 'p1',
    priorityLevel: 10,
    category: 'emergency',
    emergencyContext: String(body.emergencyContext || body.subject || '').trim().slice(0, 300),
    relatedServiceRequestId: body.relatedServiceRequestId || null,
  };
}

// POST /api/support/chats — cliente abre chamado de suporte
router.post('/chats', auth, async (req, res) => {
  const { subject } = req.body;
  if (!subject?.trim()) {
    return res.status(400).json({ message: 'Informe o assunto do atendimento' });
  }

  try {
    const priorityPayload = resolvePriorityPayload(req.user, req.body);

    // Verificar se usuário já tem chat ativo
    const existing = await SupportChat.findOne({
      userId: req.user._id,
      status: { $in: ['waiting', 'assigned'] },
    });
    if (existing) {
      // Permite escalar para P1 quando profissional sinaliza emergência em atendimento já aberto
      if (priorityPayload.priority === 'p1' && existing.priority !== 'p1') {
        existing.priority = 'p1';
        existing.priorityLevel = 10;
        existing.category = 'emergency';
        existing.emergencyContext = priorityPayload.emergencyContext || existing.emergencyContext;
        if (priorityPayload.relatedServiceRequestId) {
          existing.relatedServiceRequestId = priorityPayload.relatedServiceRequestId;
        }
        existing.messages.push({
          sender: 'user',
          text: `⚠️ Prioridade 1 acionada pelo profissional. ${priorityPayload.emergencyContext || ''}`.trim(),
        });
        await existing.save();
        const io = req.app.get('io');
        emitP1Alert(io, existing, req.user);
        await logAudit({
          module: 'support',
          action: 'support_p1_escalated',
          severity: 'critical',
          actorType: 'user',
          actorUserId: req.user._id,
          targetType: 'support_chat',
          targetId: existing._id,
          message: `Chamado escalado para P1 por ${req.user.name || 'usuário'}`,
          metadata: {
            emergencyContext: existing.emergencyContext,
            relatedServiceRequestId: existing.relatedServiceRequestId || null,
          },
        });
        return res.status(200).json({
          chatId: existing._id,
          status: existing.status,
          priority: 'p1',
          message: 'Seu atendimento existente foi escalado para Prioridade 1.',
        });
      }

      return res.status(400).json({
        message: 'Você já tem um atendimento em aberto',
        chatId: existing._id,
        status: existing.status,
        priority: existing.priority || 'normal',
      });
    }

    const chat = await SupportChat.create({
      userId: req.user._id,
      subject: subject.trim(),
      priority: priorityPayload.priority,
      priorityLevel: priorityPayload.priorityLevel,
      category: priorityPayload.category,
      emergencyContext: priorityPayload.emergencyContext,
      relatedServiceRequestId: priorityPayload.relatedServiceRequestId,
      status: 'waiting',
      queuedAt: new Date(),
    });

    const io = req.app.get('io');
    const operator = await tryAssignChat(chat._id, io);
    emitP1Alert(io, chat, req.user);

    if (chat.priority === 'p1') {
      await logAudit({
        module: 'support',
        action: 'support_p1_created',
        severity: 'critical',
        actorType: 'user',
        actorUserId: req.user._id,
        targetType: 'support_chat',
        targetId: chat._id,
        message: `Chamado P1 criado por ${req.user.name || 'usuário'}`,
        metadata: {
          emergencyContext: chat.emergencyContext,
          relatedServiceRequestId: chat.relatedServiceRequestId || null,
          assignedImmediately: !!operator,
        },
      });
    }

    const updated = await SupportChat.findById(chat._id);
    res.status(201).json({
      chatId: updated._id,
      status: updated.status,
      priority: updated.priority,
      assignedTo: operator ? operator.name : null,
      message: operator
        ? 'Atendente disponível! Você será atendido em instantes.'
        : (updated.priority === 'p1'
          ? 'Chamado P1 criado. A equipe foi sinalizada com prioridade máxima.'
          : 'Você entrou na fila. Aguarde um atendente ficar disponível.'),
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
router.post('/chats/:id/message', auth, upload.single('image'), async (req, res) => {
  const text = String(req.body.text || '').trim();
  const hasImage = !!req.file;
  if (!text && !hasImage) return res.status(400).json({ message: 'Mensagem vazia' });
  try {
    const chat = await SupportChat.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: { $in: ['waiting', 'assigned'] },
    });
    if (!chat) return res.status(404).json({ message: 'Chat não encontrado' });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    chat.messages.push({
      sender: 'user',
      text,
      imageUrl,
      imageMimeType: req.file?.mimetype || null,
    });
    await chat.save();

    // Notificar operador via socket (sala do operador)
    const io = req.app.get('io');
    if (io && chat.assignedTo) {
      io.to(`admin_${chat.assignedTo}`).emit('user_message', {
        chatId: chat._id,
        text,
        imageUrl,
        userName: req.user.name,
        userId: req.user._id,
      });
    }

    res.json({ message: 'Mensagem enviada', chat });
  } catch {
    res.status(500).json({ message: 'Erro ao enviar mensagem' });
  }
});

module.exports = router;
