import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoClipboard from 'expo-clipboard';
import {
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
  const [charge, setCharge] = useState(initialCharge);
  const [status, setStatus] = useState(initialCharge.status || 'pending');
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    const expiresAt = new Date(initialCharge.expiresAt || Date.now()).getTime();
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const [manualChecking, setManualChecking] = useState(false);
  const pollingRef = useRef(null);
  const statusRequestRef = useRef(false);

  const isFinished = useMemo(() => ['paid', 'expired', 'cancelled', 'failed'].includes(status), [status]);

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
      const { data } = await paymentAPI.getCoraPixStatus(charge.id);
      setCharge((prev) => ({ ...prev, ...data }));
      setStatus(data.status);
      if (Number.isFinite(data.remainingSeconds)) {
        setRemainingSeconds(data.remainingSeconds);
      }

      if (data.status === 'paid' && data.requestId) {
        navigation.replace('Searching', { requestId: data.requestId });
      }
    } catch {
      // Falha de rede nao deve interromper o fluxo.
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
      Alert.alert('PIX copia e cola indisponivel', 'Este QR nao retornou codigo copia e cola.');
      return;
    }

    try {
      await ExpoClipboard.setStringAsync(charge.emv);
      Alert.alert('\u2713 Codigo copiado!', 'Cole no app do seu banco para pagar.');
    } catch (e) {
      Alert.alert('Erro', 'Nao consegui copiar. Copie manualmente da tela.');
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
          <Text style={styles.timer}>Expira em {formatRemaining(remainingSeconds)}</Text>
        </View>

        {charge.id ? (
          <View style={styles.qrWrap}>
            <Image 
              source={{ uri: `${API_BASE_URL}/payments/cora/pix/${charge.id}/qr` }} 
              style={styles.qrImage} 
              resizeMode="contain" 
            />
          </View>
        ) : (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>QR code nao disponivel.</Text>
          </View>
        )}

        {charge.emv && (
          <View style={styles.card}>
            <Text style={styles.label}>PIX copia e cola</Text>
            <Text selectable style={styles.emvText}>{charge.emv}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopyPix}>
              <Ionicons name="copy" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.copyBtnText}>Copiar codigo</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          disabled={manualChecking}
          onPress={() => refreshStatus({ manual: true })}
        >
          <Text style={styles.primaryBtnText}>{manualChecking ? 'Atualizando...' : 'Ja paguei, atualizar status'}</Text>
        </TouchableOpacity>

        {status === 'expired' && (
          <Text style={styles.warning}>Tempo esgotado. Gere um novo QR para pagar.</Text>
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
});
