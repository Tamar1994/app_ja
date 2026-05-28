import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoClipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { paymentAPI } from '../../services/api';
import { colors } from '../../theme';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api';

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatRemaining(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function PixCheckoutScreen({ navigation, route }) {
  const initialCharge = route.params?.charge || {};
  const isScheduled = !!route.params?.isScheduled;
  const [charge, setCharge] = useState(initialCharge);
  const [status, setStatus] = useState(initialCharge.status || 'pending');
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    const expiresAt = new Date(initialCharge.expiresAt || Date.now()).getTime();
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const [manualChecking, setManualChecking] = useState(false);
  const pollingRef = useRef(null);
  const statusRequestRef = useRef(false);

  // Só considera "terminado" quando:
  // - pago E requestId disponível (navegação já ocorreu ou vai ocorrer)
  // - ou status terminal definitivo (expirado/cancelado/falhou)
  const isFinished = useMemo(() => {
    if (status === 'paid') return Boolean(charge.requestId);
    return ['expired', 'cancelled', 'failed'].includes(status);
  }, [status, charge.requestId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && status === 'pending') {
          setStatus('expired');
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  const refreshStatus = async ({ manual = false } = {}) => {
    if (!charge.id || statusRequestRef.current) return;
    statusRequestRef.current = true;
    try {
      if (manual) setManualChecking(true);
      const { data } = await paymentAPI.getPixStatus(charge.id);
      setCharge((prev) => ({ ...prev, ...data }));
      setStatus(data.status);
      if (Number.isFinite(data.remainingSeconds)) {
        setRemainingSeconds(data.remainingSeconds);
      }

      if (data.status === 'paid' && data.requestId) {
        // requestId disponível → navega imediatamente
        navigation.replace(isScheduled ? 'ScheduledPending' : 'Searching', { requestId: data.requestId });
      }
      // Se status=paid mas requestId=null, isFinished permanece false → polling continua
    } catch {
      // Falha de rede não interrompe o fluxo.
    } finally {
      if (manual) setManualChecking(false);
      statusRequestRef.current = false;
    }
  };

  useEffect(() => {
    refreshStatus();
    pollingRef.current = setInterval(() => {
      if (!isFinished) refreshStatus();
    }, 5000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isFinished]);

  const handleCopyPix = async () => {
    if (!charge.emv) {
      Alert.alert('PIX copia e cola indisponível', 'Este QR não retornou código copia e cola.');
      return;
    }

    try {
      await ExpoClipboard.setStringAsync(charge.emv);
      Alert.alert('✓ Código copiado!', 'Cole no app do seu banco para pagar.');
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível copiar. Copie manualmente da tela.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Pagamento via PIX</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Valor</Text>
          <Text style={styles.value}>{formatCurrency(charge.amount)}</Text>
          {status === 'pending' && (
            <Text style={styles.timer}>Expira em {formatRemaining(remainingSeconds)}</Text>
          )}
        </View>

        {status === 'expired' ? (
          <View style={styles.expiredBox}>
            <Ionicons name="time-outline" size={40} color="#B45309" style={{ marginBottom: 10 }} />
            <Text style={styles.expiredTitle}>QR Code expirado</Text>
            <Text style={styles.expiredSub}>O tempo para pagamento esgotou. Volte e gere um novo QR.</Text>
            <TouchableOpacity style={styles.newQrBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="refresh" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.newQrBtnText}>Gerar novo QR</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {charge.id && charge.emv ? (
              <View style={styles.qrWrap}>
                <Image
                  source={{ uri: `${API_BASE_URL}/payments/pix/${charge.id}/qr` }}
                  style={styles.qrImage}
                  resizeMode="contain"
                  onError={() => { /* QR PNG falhou — usuário pode usar copia e cola abaixo */ }}
                />
              </View>
            ) : (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>
                  {charge.id ? 'QR code indisponível. Use o código copia e cola abaixo.' : 'QR code não disponível.'}
                </Text>
              </View>
            )}

            {charge.emv && (
              <View style={styles.card}>
                <Text style={styles.label}>PIX copia e cola</Text>
                <Text selectable style={styles.emvText}>{charge.emv}</Text>
                <TouchableOpacity style={styles.copyBtn} onPress={handleCopyPix}>
                  <Ionicons name="copy" size={16} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.copyBtnText}>Copiar código</Text>
                </TouchableOpacity>
              </View>
            )}

            {status !== 'paid' && (
              <TouchableOpacity
                style={styles.primaryBtn}
                disabled={manualChecking}
                onPress={() => refreshStatus({ manual: true })}
              >
                <Text style={styles.primaryBtnText}>
                  {manualChecking ? 'Verificando...' : 'Já paguei, verificar status'}
                </Text>
              </TouchableOpacity>
            )}

            {status === 'paid' && !charge.requestId && (
              <View style={styles.processingBanner}>
                <ActivityIndicator size="small" color="#065F46" style={{ marginRight: 8 }} />
                <Text style={styles.processingBannerText}>
                  ✅ Pagamento confirmado! Preparando seu pedido...
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EAF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAF0',
    padding: 14,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  timer: {
    marginTop: 8,
    color: '#B45309',
    fontWeight: '700',
  },
  qrWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAF0',
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  qrImage: {
    width: 260,
    height: 260,
  },
  noticeBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: {
    color: '#92400E',
    fontSize: 13,
  },
  emvText: {
    fontSize: 12,
    color: '#111827',
    lineHeight: 18,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  copyBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  warning: {
    marginTop: 10,
    textAlign: 'center',
    color: '#B91C1C',
    fontWeight: '600',
  },
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  processingBannerText: {
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  expiredBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  expiredTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 6,
  },
  expiredSub: {
    fontSize: 14,
    color: '#78350F',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  newQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  newQrBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
