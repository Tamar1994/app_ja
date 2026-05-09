import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Em desenvolvimento: crie mobile/.env com EXPO_PUBLIC_API_URL=http://SEU_IP:3000/api
// Em produção: a variável aponta para a URL do Render
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.15.17:3000/api';

const api = axios.create({ baseURL: BASE_URL });

// Interceptor: injeta o token em todas as requisições
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  verifyEmail: (email, code) => api.post('/auth/verify-email', { email, code }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),
};

// Usuário
export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data) => api.patch('/users/me', data),
  updateLocation: (longitude, latitude) =>
    api.patch('/users/me/location', { longitude, latitude }),
  setAvailability: (isAvailable) =>
    api.patch('/users/me/availability', { isAvailable }),
  savePushToken: (token) => api.patch('/users/push-token', { token }),
  getReviews: (userId) => api.get(`/users/${userId}/reviews`),
  changePassword: (currentPassword, newPassword) =>
    api.patch('/users/me/password', { currentPassword, newPassword }),
  deleteAccount: (password) =>
    api.delete('/users/me', { data: { password } }),
};

// Solicitações de serviço
export const requestAPI = {
  estimate: (hours, hasProducts, serviceTypeSlug = null) =>
    api.post('/requests/estimate', { hours, hasProducts, serviceTypeSlug }),
  create: (data) => api.post('/requests', data),
  list: () => api.get('/requests'),
  getById: (id) => api.get(`/requests/${id}`),
  accept: (id) => api.patch(`/requests/${id}/accept`),
  reject: (id) => api.patch(`/requests/${id}/reject`),
  start: (id) => api.patch(`/requests/${id}/start`),
  complete: (id, final) => api.patch(`/requests/${id}/complete`, { final }),
  cancel: (id, reason) => api.patch(`/requests/${id}/cancel`, { reason }),
  clientReject: (id, professionalId) => api.patch(`/requests/${id}/client-reject`, { professionalId }),
  clientConfirm: (id) => api.patch(`/requests/${id}/client-confirm`),
  review: (id, rating, comment) =>
    api.post(`/requests/${id}/review`, { rating, comment }),
};

// Upload de documentos (multipart/form-data)
export const uploadDocuments = (formData) =>
  api.post('/upload/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// Carteira
export const walletAPI = {
  summary: () => api.get('/wallet/summary'),
  earnings: (period) => api.get(`/wallet/earnings?period=${period}`),
};

// Central de Ajuda
export const helpAPI = {
  getTopics: () => api.get('/help'),
  rateItem: (itemId, helpful) => api.post(`/help/items/${itemId}/rate`, { helpful }),
};

// Chat de Suporte
export const supportChatAPI = {
  create: (subject) => api.post('/support/chats', { subject }),
  getMy: () => api.get('/support/chats/my'),
  getById: (id) => api.get(`/support/chats/${id}`),
  sendMessage: (id, text) => api.post(`/support/chats/${id}/message`, { text }),
};

// Pagamentos
export const paymentAPI = {
  preview: (requestData, couponCodes = []) =>
    api.post('/payments/preview', { ...requestData, couponCodes }),
  createIntent: (requestData) => api.post('/payments/create-intent', requestData),
  confirm: (paymentIntentId) => api.post('/payments/confirm', { paymentIntentId }),
  getMethods: () => api.get('/payments/methods'),
  deleteMethod: (id) => api.delete(`/payments/methods/${id}`),
  setDefaultMethod: (id) => api.patch(`/payments/methods/${id}/default`),
};

export const couponAPI = {
  myWallet: () => api.get('/coupons/my'),
  redeem: (code) => api.post('/coupons/redeem', { code }),
};

export const serviceTypeAPI = {
  list: () => api.get('/service-types'),
};

export const termsAPI = {
  get: () => api.get('/terms'),
};

export const uploadAPI = {
  avatar: (formData) =>
    api.post('/upload/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export default api;
