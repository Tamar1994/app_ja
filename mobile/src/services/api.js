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
  saveProfessionalAddress: (address) => api.post('/auth/professional-address', address),
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
  enableProfile: (profile) => api.post('/users/me/profiles', { profile }),
  switchProfile: (profile) => api.patch('/users/me/active-profile', { profile }),
};

// Solicitações de serviço
export const requestAPI = {
  estimate: (serviceTypeSlug, tierLabel, selectedUpsells = [], scheduledDate = null) =>
    api.post('/requests/estimate', { serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate }),
  checkCoverage: (city, state = '') =>
    api.get('/requests/coverage', { params: { city, state } }),
  create: (data) => api.post('/requests', data),
  list: (scope = null) => api.get(`/requests${scope ? `?scope=${scope}` : ''}`),
  getById: (id) => api.get(`/requests/${id}`),
  scheduledFeed: () => api.get('/requests/scheduled-feed'),
  mySchedule: () => api.get('/requests/my-schedule'),
  scheduleAccept: (id) => api.patch(`/requests/${id}/schedule-accept`),
  scheduleReject: (id) => api.patch(`/requests/${id}/schedule-reject`),
  scheduleClientConfirm: (id) => api.patch(`/requests/${id}/schedule-client-confirm`),
  scheduleClientReject: (id) => api.patch(`/requests/${id}/schedule-client-reject`),
  accept: (id) => api.patch(`/requests/${id}/accept`),
  reject: (id) => api.patch(`/requests/${id}/reject`),
  start: (id) => api.patch(`/requests/${id}/start`),
  markPreparing: (id) => api.patch(`/requests/${id}/professional-preparing`),
  markOnTheWay: (id) => api.patch(`/requests/${id}/professional-on-the-way`),
  updateProfessionalLocation: (id, longitude, latitude) =>
    api.patch(`/requests/${id}/professional-location`, { longitude, latitude }),
  complete: (id, final) => api.patch(`/requests/${id}/complete`, { final }),
  cancel: (id, reason) => api.patch(`/requests/${id}/cancel`, { reason }),
  clientReject: (id, professionalId) => api.patch(`/requests/${id}/client-reject`, { professionalId }),
  clientConfirm: (id) => api.patch(`/requests/${id}/client-confirm`),
  review: (id, rating, comment) =>
    api.post(`/requests/${id}/review`, { rating, comment }),
  uploadCompletionPhotos: (id, formData) =>
    api.post(`/requests/${id}/completion-photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// Upload de documentos (multipart/form-data)
export const uploadDocuments = (formData) =>
  api.post('/upload/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then((r) => r.data);

// Upload para upgrade de cliente → profissional (comprovante de residência + docs solicitados em reenvio)
export const uploadProfessionalUpgrade = (formData) =>
  api.post('/upload/professional-upgrade', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then((r) => r.data);

export const uploadResidenceProof = (formData) =>
  api.post('/upload/residence-proof', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// Carteira
export const walletAPI = {
  summary: () => api.get('/wallet/summary'),
  earnings: (period) => api.get(`/wallet/earnings?period=${period}`),
  requestWithdrawal: (amount) => api.post('/wallet/withdrawals/request', { amount }),
  myWithdrawals: () => api.get('/wallet/withdrawals/my'),
};

// Carteira do cliente (histórico de uso)
export const clientWalletAPI = {
  preview: (requestData, couponCodes = [], useWallet = false, walletAmount = null) =>
    api.post('/payments/preview', {
      ...requestData,
      couponCodes,
      useWallet,
      walletAmount,
    }),
};

// Central de Ajuda
export const helpAPI = {
  getTopics: () => api.get('/help'),
  rateItem: (itemId, helpful) => api.post(`/help/items/${itemId}/rate`, { helpful }),
};

// Chat de Suporte
export const supportChatAPI = {
  create: (subject, extra = {}) => api.post('/support/chats', { subject, ...extra }),
  getMy: () => api.get('/support/chats/my'),
  getById: (id) => api.get(`/support/chats/${id}`),
  sendMessage: (id, text) => api.post(`/support/chats/${id}/message`, { text }),
  sendImage: (id, formData) =>
    api.post(`/support/chats/${id}/message`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export const serviceChatAPI = {
  getByRequest: (requestId) => api.get(`/service-chats/request/${requestId}`),
  sendMessage: (requestId, text) => api.post(`/service-chats/request/${requestId}/message`, { text }),
};

// Pagamentos
export const paymentAPI = {
  preview: (requestData, couponCodes = [], useWallet = false, walletAmount = null) =>
    api.post('/payments/preview', {
      ...requestData,
      couponCodes,
      useWallet,
      walletAmount,
    }),
  createIntent: (requestData) => api.post('/payments/create-intent', requestData),
  confirm: (paymentIntentId) => api.post('/payments/confirm', { paymentIntentId }),
  createCoraPixCharge: (requestData) => api.post('/payments/cora/pix/create', requestData),
  getCoraPixStatus: (chargeId) => api.get(`/payments/cora/pix/${chargeId}/status`),
  getCoraWebhookEndpoints: () => api.get('/payments/cora/webhook/endpoints'),
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
  accept: () => api.post('/auth/accept-terms'),
};

export const uploadAPI = {
  avatar: (formData) =>
    api.post('/upload/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export default api;
