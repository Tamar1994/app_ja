const SupportChat = require('../models/SupportChat');
const AdminUser = require('../models/AdminUser');

/**
 * Encontra o melhor operador disponível:
 * - online
 * - activeSupportChats < 5
 * - ordena por: menos chats ativos primeiro, depois quem ficou online antes
 */
async function findBestOperator() {
  const operator = await AdminUser.findOne({
    role: 'support',
    supportRole: 'operator',
    supportStatus: 'online',
    isActive: true,
    activeSupportChats: { $lt: 5 },
  }).sort({ activeSupportChats: 1, onlineAt: 1 });
  return operator;
}

/**
 * Recalcula as posições de todos os chats em espera e emite
 * um evento `queue_position_update` para cada usuário na fila.
 */
async function broadcastQueuePositions(io) {
  if (!io) return;
  try {
    const waitingChats = await SupportChat.find({ status: 'waiting' })
      .sort({ priorityLevel: -1, queuedAt: 1 })
      .select('_id userId');
    const total = waitingChats.length;
    waitingChats.forEach((chat, index) => {
      io.to(`user_${chat.userId}`).emit('queue_position_update', {
        chatId: String(chat._id),
        position: index + 1,
        total,
      });
    });
  } catch (err) {
    console.error('[supportQueue] broadcastQueuePositions error:', err.message);
  }
}

/**
 * Computa a posição de um chat específico na fila de espera.
 * Retorna { position, total } ou null se o chat não estiver esperando.
 */
async function getQueuePosition(chat) {
  if (!chat || chat.status !== 'waiting') return null;
  const [ahead, total] = await Promise.all([
    SupportChat.countDocuments({
      status: 'waiting',
      $or: [
        { priorityLevel: { $gt: chat.priorityLevel || 0 } },
        { priorityLevel: chat.priorityLevel || 0, queuedAt: { $lt: chat.queuedAt } },
      ],
    }),
    SupportChat.countDocuments({ status: 'waiting' }),
  ]);
  return { position: ahead + 1, total };
}

/**
 * Tenta atribuir um chat (waiting) ao melhor operador disponível.
 * Usa update atômico para evitar race condition.
 * Retorna o operador atribuído ou null se não houver.
 */
async function tryAssignChat(chatId, io) {
  const operator = await findBestOperator();
  if (!operator) return null;

  const assigned = await SupportChat.findOneAndUpdate(
    { _id: chatId, status: 'waiting' },
    {
      status: 'assigned',
      assignedTo: operator._id,
      assignedAt: new Date(),
      // Mensagem de sistema: atendente entrou na conversa
      $push: {
        messages: {
          sender: 'system',
          text: `${operator.name} entrou na conversa.`,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );
  if (!assigned) return null; // já foi atribuído (race condition)

  await AdminUser.findByIdAndUpdate(operator._id, {
    $inc: { activeSupportChats: 1 },
  });

  if (io) {
    // Notificar cliente: foi atribuído
    io.to(`user_${assigned.userId}`).emit('chat_assigned', {
      chatId: String(assigned._id),
      operatorName: operator.name,
    });
    // Atualizar posições dos demais usuários em espera
    await broadcastQueuePositions(io);
  }

  return operator;
}

/**
 * Chamado quando um chat é encerrado.
 * Decrementa contador do operador e tenta puxar próximo da fila.
 */
async function onChatClosed(operatorId, io) {
  if (!operatorId) return;

  await AdminUser.findByIdAndUpdate(operatorId, {
    $inc: { activeSupportChats: -1 },
  });

  // Corrigir se ficou negativo
  await AdminUser.findOneAndUpdate(
    { _id: operatorId, activeSupportChats: { $lt: 0 } },
    { activeSupportChats: 0 }
  );

  const operator = await AdminUser.findById(operatorId);
  if (!operator) return;

  if (operator.supportStatus === 'pause_scheduled' && operator.activeSupportChats === 0) {
    const durationMinutes = Math.max(1, Math.min(180, Number(operator.pauseDurationMinutes || 10)));
    operator.supportStatus = 'paused';
    operator.pauseStartAt = new Date();
    operator.pauseEndsAt = new Date(Date.now() + durationMinutes * 60000);
    await operator.save();
    return;
  }

  if (operator.supportStatus !== 'online' || operator.activeSupportChats >= 5) return;

  // Puxar próximo da fila priorizando P1 e depois mais antigo
  const nextChat = await SupportChat.findOne({ status: 'waiting' }).sort({ priorityLevel: -1, queuedAt: 1 });
  if (!nextChat) return;

  await tryAssignChat(nextChat._id, io);
}

/**
 * Chamado quando um operador fica offline (logout, fechar aba, perda de conexão).
 * Move todos os chats atribuídos de volta para a fila e tenta redistribuir.
 */
async function reassignChatsFrom(operatorId, io) {
  try {
    const opId = String(operatorId);

    // Marcar operador offline e zerar contador
    await AdminUser.findByIdAndUpdate(opId, {
      supportStatus: 'offline',
      activeSupportChats: 0,
    });

    // Buscar chats atribuídos a esse operador
    const chats = await SupportChat.find({ assignedTo: opId, status: 'assigned' }).select('_id userId');
    if (!chats.length) return;

    // Mover de volta para a fila com mensagem de sistema
    await SupportChat.updateMany(
      { assignedTo: opId, status: 'assigned' },
      {
        status: 'waiting',
        assignedTo: null,
        assignedAt: null,
      }
    );

    // Inserir mensagem de sistema em cada chat e notificar o usuário
    for (const chat of chats) {
      await SupportChat.findByIdAndUpdate(chat._id, {
        $push: {
          messages: {
            sender: 'system',
            text: 'O atendente ficou indisponível. Você voltou para a fila — um novo atendente será atribuído em breve.',
            createdAt: new Date(),
          },
        },
      });

      if (io) {
        io.to(`user_${chat.userId}`).emit('chat_unassigned', {
          chatId: String(chat._id),
          reason: 'operator_offline',
        });
      }
    }

    // Atualizar posições para todos na fila
    await broadcastQueuePositions(io);

    // Tentar redistribuir os chats para outros operadores disponíveis
    for (const chat of chats) {
      await tryAssignChat(chat._id, io);
    }
  } catch (err) {
    console.error('[supportQueue] reassignChatsFrom error:', err.message);
  }
}

module.exports = { tryAssignChat, onChatClosed, findBestOperator, broadcastQueuePositions, getQueuePosition, reassignChatsFrom };
