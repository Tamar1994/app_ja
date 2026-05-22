import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { notificationsAPI } from '../services/api';

const NotificationContext = createContext({ unreadCount: 0, refreshCount: () => {}, setUnreadCount: () => {} });

export function NotificationProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const fetchingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data } = await notificationsAPI.unreadCount();
      setUnreadCount(data.count ?? 0);
    } catch {
      // silencia erros de rede — badge simplesmente não atualiza
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount, refreshCount, setUnreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationBadge() {
  return useContext(NotificationContext);
}
