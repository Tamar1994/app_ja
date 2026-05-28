import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import { NotificationProvider } from './src/context/NotificationContext';
import RootNavigator, { navigationRef } from './src/navigation';
import { setPendingNotification } from './src/services/pendingNotification';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api';



function App() {
  const notificationResponseSub = useRef(null);
  useEffect(() => {
    // Quando usuário TOCA na notificação (app estava em background ou fechado)
    notificationResponseSub.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        // Se for um novo pedido, salvar para o DashboardScreen pegar
        if (data?.type === 'new_request') {
          setPendingNotification({
            requestId: data.requestId,
            client: data.client,
            details: data.details,
            address: data.address,
            pricing: data.pricing,
            timeoutAt: data.timeoutAt,
          });
        }
        // Notificação de mensagem de chat — será tratada pelo navigator quando montar
        if (data?.type === 'chat_message' && data?.requestId) {
          setPendingNotification({ type: 'chat_message', requestId: data.requestId });
        }
        // Notificação de mensagem de suporte — navegar para SupportChatScreen
        if (data?.type === 'support_message') {
          if (navigationRef.isReady()) {
            // App estava em background — navegar diretamente
            navigationRef.navigate('SupportTab', { screen: 'SupportChat' });
          } else {
            // App estava fechado — HomeScreen vai consumir ao focar
            setPendingNotification({ type: 'support_message' });
          }
        }
      }
    );

    return () => {
      notificationResponseSub.current?.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SocketProvider>
            <NotificationProvider>
              <RootNavigator />
            </NotificationProvider>
            <StatusBar style="auto" />
          </SocketProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
registerRootComponent(App);
