const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('Usuário não encontrado'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    // Cada usuário entra em sua sala privada
    socket.join(`user_${userId}`);
    console.log(`🔌 Conectado: ${socket.user.name} (${socket.user.userType})`);

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
      console.log(`🔌 Desconectado: ${socket.user.name}`);
    });
  });

  // Expor io na app Express para uso nas rotas
  return io;
};

module.exports = initSocket;
