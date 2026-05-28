import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoClipboard from 'expo-clipboard';
import {
  ActivityIndicator, Alert, Image, Platform, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
  return mm + ':' + ss;
}

function timerColor(seconds) {
  if (seconds > 600) return colors.success;
  if (seconds > 120) return '#F59E0B';
  return colors.error;
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
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef(null);
  const statusRequestRef = useRef(false);

  const isFinished = useMemo(() => {
    if (status === 'paid') return Boolean(charge.requestId);
    return ['expired', 'cancelled', 'failed'].includes(status);
  }, [status, charge.requestId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && status === 'pending') setStatus('expired');
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
      if (Number.isFinite(data.remainingSeconds)) setRemainingSeconds(data.remainingSeconds);
      if (data.status === 'paid' && data.requestId) {
        navigation.replace(isScheduled ? 'ScheduledPending' : 'Searching', { requestId: data.requestId });
      }
    } catch { /* rede — nao interrompe fluxo */ } finally {
      if (manual) setManualChecking(false);
      statusRequestRef.current = false;
    }
  };

  useEffect(() => {
    refreshStatus();
    pollingRef.current = setInterval(() => { if (!isFinished) refreshStatus(); }, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [isFinished]);

  const handleCopyPix = async () => {
    if (!charge.emv) { Alert.alert('Indisponivel', 'Codigo copia e cola nao disponivel para este QR.'); return; }
    try {
      await ExpoClipboard.setStringAsync(charge.emv);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch { Alert.alert('Erro', 'Nao foi possivel copiar. Copie manualmente.'); }
  };

  const tColor = timerColor(remainingSeconds);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Gradient header */}
      <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={styles.headerTitle}>Pagamento PIX</Text>
          <Text style={styles.headerAmount}>{formatCurrency(charge.amount)}</Text>
        </View>
        <View style={{ width: 36 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Status pago */}
        {status === 'paid' && !charge.requestId && (
          <View style={styles.paidBanner}>
            <ActivityIndicator size="small" color="#065F46" style={{ marginRight: 8 }} />
            <Text style={styles.paidBannerText}>Pagamento confirmado! Preparando seu pedido...</Text>
          </View>
        )}

        {/* Status expirado */}
        {status === 'expired' && (
          <View style={styles.expiredCard}>
            <View style={styles.expiredIconWrap}>
              <Ionicons name="time-outline" size={36} color="#B45309" />
            </View>
            <Text style={styles.expiredTitle}>QR Code expirado</Text>
            <Text style={styles.expiredSub}>O tempo para pagamento esgotou.</Text>
            <TouchableOpacity style={styles.newQrBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <LinearGradient colors={colors.gradientPrimary} style={styles.newQrBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Ionicons name="refresh" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.newQrBtnText}>Gerar novo QR</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* QR Code + timer (status pending) */}
        {status !== 'expired' && (
          <>
            {/* Timer */}
            {status === 'pending' && (
              <View style={[styles.timerCard, { borderColor: tColor + '33' }]}>
                <Ionicons name="time-outline" size={18} color={tColor} />
                <Text style={[styles.timerLabel, { color: tColor }]}>Expira em</Text>
                <Text style={[styles.timerValue, { color: tColor }]}>{formatRemaining(remainingSeconds)}</Text>
              </View>
            )}

            {/* QR code */}
            {charge.id && charge.emv ? (
              <View style={styles.qrCard}>
                <View style={styles.qrInner}>
                  <Image
                    source={{ uri: API_BASE_URL + '/payments/pix/' + charge.id + '/qr' }}
                    style={styles.qrImage}
                    resizeMode="contain"
                    onError={() => {}}
                  />
                </View>
                <Text style={styles.qrHint}>Aponte a camera do seu banco para o QR Code</Text>
              </View>
            ) : (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={48} color={colors.textLight} />
                <Text style={styles.qrPlaceholderText}>QR indisponivel — use o codigo abaixo</Text>
              </View>
            )}

            {/* Copia e cola */}
            {charge.emv && (
              <View style={styles.emvCard}>
                <View style={styles.emvHeader}>
                  <Ionicons name="copy-outline" size={15} color={colors.primary} />
                  <Text style={styles.emvTitle}>PIX Copia e Cola</Text>
                </View>
                <Text selectable style={styles.emvText} numberOfLines={3}>{charge.emv}</Text>
                <TouchableOpacity style={[styles.copyBtn, copied && styles.copyBtnSuccess]} onPress={handleCopyPix} activeOpacity={0.85}>
                  <Ionicons name={copied ? 'checkmark-circle' : 'copy'} size={16} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.copyBtnText}>{copied ? 'Copiado!' : 'Copiar codigo'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Verificar pagamento */}
            {status !== 'paid' && (
              <TouchableOpacity style={styles.verifyBtn} onPress={() => refreshStatus({ manual: true })} disabled={manualChecking} activeOpacity={0.85}>
                <LinearGradient colors={manualChecking ? ['#B0BEC5', '#90A4AE'] : [colors.secondary, '#1976D2']} style={styles.verifyBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {manualChecking
                    ? <ActivityIndicator color="#fff" size="small" />
                    : (<>
                        <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={styles.verifyBtnText}>Ja paguei — verificar agora</Text>
                      </>)}
                </LinearGradient>
              </TouchableOpacity>
            )}

            {/* Instrucoes */}
            <View style={styles.stepsCard}>
              <Text style={styles.stepsTitle}>Como pagar com PIX</Text>
              {[
                ['1', 'Abra o app do seu banco'],
                ['2', 'Escolha pagar com PIX QR Code ou Copia e Cola'],
                ['3', 'Aponte a camera ou cole o codigo'],
                ['4', 'Confirme o pagamento'],
              ].map(([num, text]) => (
                <View key={num} style={styles.stepRow}>
                  <View style={styles.stepNumWrap}><Text style={styles.stepNum}>{num}</Text></View>
                  <Text style={styles.stepText}>{text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.secureRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
              <Text style={styles.secureText}>Pagamento processado com seguranca via Asaas</Text>
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6FB' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  headerAmount: { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: 2 },

  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 12 },

  paidBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#D1FAE5', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#6EE7B7' },
  paidBannerText: { color: '#065F46', fontWeight: '600', flex: 1, fontSize: 14, lineHeight: 20 },

  expiredCard: { backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  expiredIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFFBEB', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  expiredTitle: { fontSize: 20, fontWeight: '800', color: '#92400E', marginBottom: 6 },
  expiredSub: { fontSize: 14, color: '#B45309', textAlign: 'center', marginBottom: 24 },
  newQrBtn: { borderRadius: 12, overflow: 'hidden', width: '100%' },
  newQrBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  newQrBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  timerCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20, borderWidth: 1.5, shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  timerLabel: { fontSize: 13, fontWeight: '600' },
  timerValue: { fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },

  qrCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, alignItems: 'center', shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
  qrInner: { backgroundColor: '#fff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#F0F2F8' },
  qrImage: { width: 240, height: 240 },
  qrHint: { marginTop: 14, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },

  qrPlaceholder: { backgroundColor: '#fff', borderRadius: 20, padding: 40, alignItems: 'center', gap: 12, shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  qrPlaceholderText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },

  emvCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  emvHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  emvTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  emvText: { fontSize: 11, color: colors.textSecondary, lineHeight: 16, marginBottom: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12 },
  copyBtnSuccess: { backgroundColor: colors.success },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  verifyBtn: { borderRadius: 14, overflow: 'hidden' },
  verifyBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14 },
  verifyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  stepsCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, gap: 12 },
  stepsTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumWrap: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFF3EA', alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 13, fontWeight: '800', color: colors.primary },
  stepText: { fontSize: 13, color: colors.textSecondary, flex: 1 },

  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secureText: { fontSize: 12, color: colors.textSecondary },
});
