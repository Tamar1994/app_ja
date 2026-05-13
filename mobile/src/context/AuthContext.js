import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authAPI, userAPI } from '../services/api';
import { registerForPushNotifications } from '../services/notifications';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const pushRegisteredRef = useRef(false);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  // Registrar token de push para TODOS os tipos de usuário assim que logar
  useEffect(() => {
    if (!user || pushRegisteredRef.current) return;
    pushRegisteredRef.current = true;
    registerForPushNotifications()
      .then((pushToken) => {
        if (pushToken) userAPI.savePushToken(pushToken).catch(() => {});
      })
      .catch(() => {});
  }, [user?._id]);

  const loadStoredAuth = async () => {
    setNetworkError(false);
    try {
      const storedToken = await SecureStore.getItemAsync('token');
      if (storedToken) {
        setToken(storedToken);
        const { data } = await userAPI.getMe();
        setUser(data.user);
      }
    } catch (err) {
      // Só apaga o token em erros de autenticação (401/403).
      // Erros de rede (servidor reiniciando, sem conexão) não devem deslogar o usuário.
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await SecureStore.deleteItemAsync('token');
        setToken(null);
        setUser(null);
      } else if (!err?.response) {
        // Sem resposta HTTP = erro de rede (timeout, servidor offline, etc.)
        // Verifica se havia token antes de mostrar tela de retry
        const storedToken = await SecureStore.getItemAsync('token');
        if (storedToken) setNetworkError(true);
      }
      // Outros erros HTTP (5xx etc.) — mantém o token sem exibir tela de retry
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data } = await authAPI.login(email, password);
    await SecureStore.setItemAsync('token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (formData) => {
    const { data } = await authAPI.register(formData);
    // Não faz login ainda — aguarda verificação de e-mail
    return data;
  };

  const verifyEmail = async (email, code) => {
    const { data } = await authAPI.verifyEmail(email, code);
    await SecureStore.setItemAsync('token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const resendVerification = async (email) => {
    await authAPI.resendVerification(email);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('token');
    setToken(null);
    setUser(null);
  };

  const updateUser = (updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  };

  return (
    <AuthContext.Provider value={{ user, setUser, token, loading, networkError, retryAuth: loadStoredAuth, login, register, logout, updateUser, verifyEmail, resendVerification }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
};
