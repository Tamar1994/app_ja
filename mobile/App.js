import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import RootNavigator from './src/navigation';
import { setPendingNotification } from './src/services/pendingNotification';

// Configurar comportamento de foreground (mostrar alerta + tocar som mesmo com app aberto)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
      }
    );

    return () => {
      notificationResponseSub.current?.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SocketProvider>
          <RootNavigator />
          <StatusBar style="auto" />
        </SocketProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

export default App;
registerRootComponent(App);
