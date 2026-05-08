/**
 * notifications.js — Registro e configuração de push notifications
 * 
 * Cobre todos os cenários:
 *  - App em foreground: recebe via socket (IncomingJobModal) E via notificação
 *  - App em background: notificação heads-up aparece no topo da tela com som
 *  - App fechado/tela desligada: notificação toca alarme, acende tela
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ─── Handler de foreground ─────────────────────────────────────────────────
// Quando a notificação chega com o app aberto, mostramos o alerta + som
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,   // mostrar banner mesmo com app aberto
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Criar canal de notificação de alta prioridade no Android.
 * IMPORTÂNCIA MAX = aparece em tela cheia, toca som, vibra, ignora modo silencioso.
 */
async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('job-alerts', {
    name: 'Novos Pedidos — Já!',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500, 200, 500, 200, 500],
    lightColor: '#FF6B00',
    sound: 'default',
    bypassDnd: true,             // ignora "Não Perturbe"
    enableLights: true,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  });
}

/**
 * Solicitar permissão e registrar token de push.
 * Retorna o token Expo ou null se não autorizado.
 */
export async function registerForPushNotifications() {
  await setupAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true, // iOS: ignora modo silencioso
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permissão negada');
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'fbebee6b-64e1-48f0-bc40-67bbec6ab531',
    });
    console.log('[Push] Token registrado:', tokenData.data);
    return tokenData.data;
  } catch (err) {
    console.log('[Push] Erro ao obter token:', err.message);
    return null;
  }
}
