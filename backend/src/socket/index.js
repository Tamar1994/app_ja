const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AdminUser = require('../models/AdminUser');
const { hasPermission, ADMIN_PERMISSIONS } = require('../middleware/adminAuth');
const { reassignChatsFrom } = require('../utils/supportQueue');

// Mapa de timers de "grace period" para operadores desconectados.
// Grace period: 30s — se o operador reconectar antes disso, cancela o offline.
const operatorDisconnectTimers = new Map();

const initSocket = (server) => {
  const io = new Server(server, {
    cors: { origin: '*' },
  });

  // Middleware de autenticação via socket
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token não fornecido'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.isAdmin) {
        const admin = await AdminUser.findById(decoded.id);
        if (!admin || !admin.isActive) return next(new Error('Admin não encontrado'));
        socket.admin = admin;
        socket.actorType = 'admin';
      } else {
        const user = await User.findById(decoded.id);
        if (!user) return next(new Error('Usuário não encontrado'));
        socket.user = user;
        socket.actorType = 'user';
      }
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.actorType === 'admin' && socket.admin) {
      const adminId = socket.admin._id.toString();
      socket.join(`admin_${adminId}`);
      socket.join('admins');
      if (hasPermission(socket.admin, ADMIN_PERMISSIONS.SUPPORT_CHAT)) {
        socket.join('support_ops');
      }

      // Se havia um timer de grace period pendente para este operador,
      // cancelar — ele reconectou a tempo.
      if (operatorDisconnectTimers.has(adminId)) {
        clearTimeout(operatorDisconnectTimers.get(adminId));
        operatorDisconnectTimers.delete(adminId);
      }

      socket.on('disconnect', async () => {
        // Grace period de 30s antes de marcar offline.
        // Cobre: troca de aba no browser, reload de página, navegação no app mobile.
        // NÃO cobre: logout explícito (que chama PATCH /support/toggle-status antes de desconectar).
        const GRACE_MS = 30_000;

        // Cancelar timer anterior se houver (múltiplas conexões do mesmo admin)
        if (operatorDisconnectTimers.has(adminId)) {
          clearTimeout(operatorDisconnectTimers.get(adminId));
        }

        const timer = setTimeout(async () => {
          operatorDisconnectTimers.delete(adminId);
          try {
            const admin = await AdminUser.findById(adminId).select('supportStatus');
            if (admin && admin.supportStatus !== 'offline') {
              await reassignChatsFrom(adminId, io);
            }
          } catch (err) {
            console.error('[socket] Erro ao redistribuir chats do operador:', err.message);
          }
        }, GRACE_MS);

        operatorDisconnectTimers.set(adminId, timer);
      });
      return;
    }

    const userId = socket.user._id.toString();
    // Cada usuário entra em sua sala privada
    socket.join(`user_${userId}`);

    // Profissional entra na sala de disponíveis
    if (socket.user.userType === 'professional') {
      socket.join('professionals');
    }

    // Atualizar localização em tempo real (profissional)
    socket.on('update_location', async ({ longitude, latitude }) => {
      if (socket.user.userType !== 'professional') return;
      await User.findByIdAndUpdate(userId, {
        location: { type: 'Point', coordinates: [longitude, latitude] },
      });
      // Notificar clientes com serviços ativos desse profissional
      socket.broadcast.emit(`professional_location_${userId}`, { longitude, latitude });
    });

    // Profissional fica/sai de disponível
    socket.on('toggle_availability', async ({ isAvailable }) => {
      if (socket.user.userType !== 'professional') return;
      await User.findByIdAndUpdate(userId, { 'professional.isAvailable': isAvailable });
      if (isAvailable) {
        socket.join('professionals');
      } else {
        socket.leave('professionals');
      }
    });

    socket.on('disconnect', () => {
    });
  });

  // Expor io na app Express para uso nas rotas
  return io;
};

module.exports = initSocket;
