import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api')
  .replace(/\/api\/?$/, '');

let socketInstance = null;

export function connectAdminSocket(token) {
  if (socketInstance?.connected) return socketInstance;
  socketInstance = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });
  return socketInstance;
}

export function disconnectAdminSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

export function getAdminSocket() {
  return socketInstance;
}
