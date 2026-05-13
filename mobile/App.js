import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import RootNavigator from './src/navigation';
import { setPendingNotification } from './src/services/pendingNotification';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api';

// Chave publicável fallback (teste) — substituída dinamicamente ao conectar ao backend
const STRIPE_KEY_FALLBACK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  || 'pk_test_51TUoUF4ADp0LjMACG0EjuLkj8Iy2iCr4XiTHmml5rfXZj7SfPxBH9gBLfpJnDBsy00zYpuFAgqwYXnd6WmqsSf9p00OPpz9IUx';

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
  const [stripeKey, setStripeKey] = useState(STRIPE_KEY_FALLBACK);

  useEffect(() => {
    // Busca a chave publicável atual do backend (pode ser test ou production)
    fetch(`${API_URL}/payments/config`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.publishableKey) setStripeKey(data.publishableKey);
      })
      .catch(() => {/* usa fallback */});
  }, []);

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
      }
    );

    return () => {
      notificationResponseSub.current?.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider publishableKey={stripeKey} merchantIdentifier="merchant.com.ja.app" scheme="ja-app">
          <AuthProvider>
            <SocketProvider>
              <RootNavigator />
              <StatusBar style="auto" />
            </SocketProvider>
          </AuthProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
registerRootComponent(App);
