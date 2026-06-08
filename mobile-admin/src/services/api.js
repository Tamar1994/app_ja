import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api';

const api = axios.create({ baseURL: BASE_URL, timeout: 20000 });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const adminAuthAPI = {
  login: (email, password) => api.post('/admin/login', { email, password }),
};

export const adminSupportAPI = {
  // Status online/offline
  toggleStatus: () => api.patch('/admin/support/toggle-status'),
  getStatus: () => api.get('/admin/support/status'),

  // Lista de chats atribuídos a mim
  myChats: () => api.get('/admin/support/my-chats'),

  // Todos os chats em espera (fila)
  allChats: (status = 'waiting') =>
    api.get('/admin/chats', { params: { status } }),

  // Detalhe de um chat
  getChat: (id) => api.get(`/admin/support/chats/${id}`),

  // Enviar mensagem
  sendMessage: (id, text) =>
    api.post(`/admin/support/chats/${id}/message`, { text }),

  // Encerrar chat
  closeChat: (id) => api.patch(`/admin/support/chats/${id}/close`),
};
