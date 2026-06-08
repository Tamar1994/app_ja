import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { adminAuthAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const storedToken = await SecureStore.getItemAsync('admin_token');
        const storedAdmin = await SecureStore.getItemAsync('admin_data');
        if (storedToken && storedAdmin) {
          setToken(storedToken);
          setAdmin(JSON.parse(storedAdmin));
        }
      } catch {
        // ignora erro de leitura
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
    const { data } = await adminAuthAPI.login(email, password);
    await SecureStore.setItemAsync('admin_token', data.token);
    await SecureStore.setItemAsync('admin_data', JSON.stringify(data.admin));
    setToken(data.token);
    setAdmin(data.admin);
    return data;
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('admin_token');
    await SecureStore.deleteItemAsync('admin_data');
    setToken(null);
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
