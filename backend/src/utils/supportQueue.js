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
    supportStatus: 'online',
    isActive: true,
    activeSupportChats: { $lt: 5 },
  }).sort({ activeSupportChats: 1, onlineAt: 1 });
  return operator;
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
    },
    { new: true }
  );
  if (!assigned) return null; // já foi atribuído

  await AdminUser.findByIdAndUpdate(operator._id, {
    $inc: { activeSupportChats: 1 },
  });

  // Notificar cliente via socket
  if (io) {
    io.to(`user_${assigned.userId}`).emit('chat_assigned', {
      chatId: assigned._id,
      operatorName: operator.name,
    });
  }

  return operator;
}

/**
 * Chamado quando um chat é encerrado.
 * Decrementa contador do operador e tenta puxar próximo da fila.
 */
async function onChatClosed(operatorId, io) {
  if (!operatorId) return;

  // Garantir que não fique negativo
  await AdminUser.findByIdAndUpdate(operatorId, {
    $inc: { activeSupportChats: -1 },
  });

  // Corrigir se ficou negativo
  await AdminUser.findOneAndUpdate(
    { _id: operatorId, activeSupportChats: { $lt: 0 } },
    { activeSupportChats: 0 }
  );

  const operator = await AdminUser.findById(operatorId);
  if (!operator || operator.supportStatus !== 'online' || operator.activeSupportChats >= 5) return;

  // Puxar próximo da fila (mais antigo primeiro)
  const nextChat = await SupportChat.findOne({ status: 'waiting' }).sort({ queuedAt: 1 });
  if (!nextChat) return;

  await tryAssignChat(nextChat._id, io);
}

module.exports = { tryAssignChat, onChatClosed, findBestOperator };
