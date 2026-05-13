const express = require('express');
const auth = require('../middleware/auth');
const ServiceRequest = require('../models/ServiceRequest');
const ServiceChat = require('../models/ServiceChat');
const User = require('../models/User');
const { ensureServiceChatForRequest } = require('../utils/serviceChat');
const { sendExpoPush } = require('../utils/requestQueue');

const router = express.Router();

async function findParticipantRequest(requestId, user) {
  const filter = { _id: requestId };
  if (user.userType === 'client') filter.client = user._id;
  if (user.userType === 'professional') filter.professional = user._id;
  return ServiceRequest.findOne(filter)
    .populate('client', 'name avatar')
    .populate('professional', 'name avatar');
}

router.get('/request/:requestId', auth, async (req, res) => {
  try {
    const serviceRequest = await findParticipantRequest(req.params.requestId, req.user);
    if (!serviceRequest) return res.status(404).json({ message: 'Serviço não encontrado' });
    if (!serviceRequest.professional || !serviceRequest.clientConfirmedAt) {
      return res.status(400).json({ message: 'O chat será liberado após a confirmação do cliente.' });
    }

    let chat = await ServiceChat.findOne({ requestId: serviceRequest._id });
    if (!chat) chat = await ensureServiceChatForRequest(serviceRequest);
    if (!chat) return res.status(400).json({ message: 'Chat indisponível para este serviço.' });

    res.json({ chat, request: serviceRequest });
  } catch {
    res.status(500).json({ message: 'Erro ao buscar chat do serviço' });
  }
});

router.post('/request/:requestId/message', auth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ message: 'Mensagem vazia' });

  try {
    const serviceRequest = await findParticipantRequest(req.params.requestId, req.user);
    if (!serviceRequest) return res.status(404).json({ message: 'Serviço não encontrado' });
    if (!serviceRequest.professional || !serviceRequest.clientConfirmedAt) {
      return res.status(400).json({ message: 'O chat ainda não está liberado.' });
    }

    let chat = await ServiceChat.findOne({ requestId: serviceRequest._id });
    if (!chat) chat = await ensureServiceChatForRequest(serviceRequest);
    if (!chat) return res.status(400).json({ message: 'Chat indisponível para este serviço.' });
    if (chat.status !== 'active') return res.status(400).json({ message: 'Este chat já foi encerrado.' });

    chat.messages.push({
      sender: req.user.userType === 'professional' ? 'professional' : 'client',
      text: text.trim(),
    });
    await chat.save();

    // Notificar o outro participante via push notification
    try {
      const senderType = req.user.userType === 'professional' ? 'professional' : 'client';
      const recipientId = senderType === 'client'
        ? serviceRequest.professional?._id
        : serviceRequest.client?._id;
      if (recipientId) {
        const recipient = await User.findById(recipientId).select('pushToken name');
        if (recipient?.pushToken) {
          const senderName = req.user.name || (senderType === 'client' ? 'Cliente' : 'Profissional');
          sendExpoPush(
            recipient.pushToken,
            `💬 ${senderName}`,
            text.trim().length > 80 ? text.trim().substring(0, 80) + '…' : text.trim(),
            { type: 'chat_message', requestId: serviceRequest._id.toString() }
          );
        }
      }
    } catch { /* push é melhor esforço */ }

    res.json({ message: 'Mensagem enviada', chat });
  } catch {
    res.status(500).json({ message: 'Erro ao enviar mensagem no chat do serviço' });
  }
});

module.exports = router;
