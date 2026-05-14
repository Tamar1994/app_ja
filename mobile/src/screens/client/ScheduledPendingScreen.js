import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSocket } from '../../context/SocketContext';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ScheduledPendingScreen({ navigation, route }) {
  const { requestId, estimate } = route.params;
  const { on } = useSocket();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [professional, setProfessional] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadRequest = useCallback(async () => {
    try {
      const { data } = await requestAPI.getById(requestId);
      setRequest(data.request);
    } catch {
      // ignora
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadRequest();

    const unsub = on('schedule_professional_accepted', ({ request: r, professional: p }) => {
      if (r._id?.toString() === requestId) {
        setRequest(r);
        setProfessional(p);
      }
    });

    // Polling leve a cada 30s
    const poll = setInterval(loadRequest, 30000);
    return () => {
      unsub && unsub();
      clearInterval(poll);
    };
  }, [requestId, loadRequest]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await requestAPI.scheduleClientConfirm(requestId);
      Alert.alert(
        '🎉 Agendamento confirmado!',
        'O profissional foi notificado e o serviço está na sua agenda.',
        [{ text: 'Ótimo!', onPress: () => navigation.replace('Home') }],
      );
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível confirmar.');
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = () => {
    Alert.alert(
      'Recusar profissional',
      'Deseja buscar outro profissional para este agendamento?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, buscar outro',
          style: 'destructive',
          onPress: async () => {
            try {
              await requestAPI.scheduleClientReject(requestId);
              setProfessional(null);
              setRequest(prev => ({ ...prev, status: 'pending_professional', professional: null }));
            } catch (err) {
              Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível recusar.');
            }
          },
        },
      ],
    );
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancelar agendamento',
      'Deseja cancelar este agendamento completamente?',
      [
        { text: 'Não', style: 'cancel' },
        {
          text: 'Sim, cancelar',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await requestAPI.cancel(requestId, 'Cancelado pelo cliente');
              navigation.replace('Home');
            } catch {
              Alert.alert('Erro', 'Não foi possível cancelar.');
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  const status = request?.status;
  const hasProfessional = status === 'pending_client' && (professional || request?.professional);
  const prof = professional || request?.professional;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.replace('Home')}>
          <Ionicons name="home-outline" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Agendamento</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Status banner */}
          {hasProfessional ? (
            <LinearGradient colors={[colors.success + '20', colors.success + '08']} style={styles.statusBanner}>
              <Ionicons name="person-circle" size={40} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>Profissional encontrado!</Text>
                <Text style={styles.statusSub}>Confirme para garantir seu agendamento</Text>
              </View>
            </LinearGradient>
          ) : (
            <LinearGradient colors={['#EEF2FF', '#E8F0FE']} style={styles.statusBanner}>
              <Ionicons name="time-outline" size={40} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>Aguardando profissional</Text>
                <Text style={styles.statusSub}>Os profissionais disponíveis podem aceitar seu agendamento. Você será notificado assim que houver interesse.</Text>
              </View>
            </LinearGradient>
          )}

          {/* Detalhes do agendamento */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Detalhes do agendamento</Text>
            {[
              { icon: 'pricetag-outline', label: 'Serviço', value: request?.details?.tierLabel || '-' },
              { icon: 'calendar-outline', label: 'Data/hora', value: formatDateTime(request?.details?.scheduledDate) },
              { icon: 'location-outline', label: 'Endereço', value: `${request?.address?.street || ''}, ${request?.address?.city || ''}` },
              { icon: 'cash-outline', label: 'Estimativa', value: `R$ ${Number(request?.pricing?.estimated || estimate?.estimated || 0).toFixed(2)}` },
            ].map((row, i, arr) => (
              <View key={i} style={[styles.detailRow, i < arr.length - 1 && styles.detailRowBorder]}>
                <View style={styles.detailIcon}>
                  <Ionicons name={row.icon} size={16} color={colors.primary} />
                </View>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* Card do profissional */}
          {hasProfessional && prof && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profissional disponível</Text>
              <View style={styles.profRow}>
                <LinearGradient colors={colors.gradientSecondary} style={styles.profAvatar}>
                  <Text style={styles.profAvatarText}>{prof.name?.[0] || '?'}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profName}>{prof.name}</Text>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={14} color={colors.warning} />
                    <Text style={styles.ratingText}>
                      {Number(prof.rating || 0).toFixed(1)} · {prof.totalReviews || 0} avaliações
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.profActions}>
                <TouchableOpacity style={styles.btnReject} onPress={handleReject} disabled={confirming}>
                  <Text style={styles.btnRejectText}>Recusar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnConfirmWrap} onPress={handleConfirm} disabled={confirming}>
                  <LinearGradient colors={[colors.success, '#00A044']} style={styles.btnConfirm}>
                    {confirming
                      ? <ActivityIndicator color={colors.white} />
                      : <Text style={styles.btnConfirmText}>Confirmar profissional</Text>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Nota de pagamento */}
          <View style={styles.noteCard}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.noteText}>
              O pagamento só é realizado após a conclusão do serviço. Você pode cancelar o agendamento enquanto o profissional não tiver sido confirmado.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.btnHome}
            onPress={() => navigation.replace('Home')}
          >
            <Text style={styles.btnHomeText}>Ir para início</Text>
          </TouchableOpacity>

          {(status === 'pending_professional' || status === 'pending_client') && (
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={handleCancel}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator color={colors.error} />
                : <Text style={styles.btnCancelText}>Cancelar agendamento</Text>}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 55, paddingBottom: 16, paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.white },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    borderRadius: borderRadius.xl, padding: spacing.lg,
    borderWidth: 1, borderColor: 'transparent',
  },
  statusTitle: { fontSize: typography.fontSizes.lg, fontWeight: '800', color: colors.textPrimary },
  statusSub: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 4, lineHeight: 20 },
  card: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    padding: spacing.lg, ...shadows.md,
  },
  cardTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: spacing.sm,
  },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center',
  },
  detailLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, width: 70 },
  detailValue: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '600' },
  profRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  profAvatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  profAvatarText: { fontSize: 20, fontWeight: '800', color: colors.white },
  profName: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ratingText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  profActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btnReject: {
    flex: 1, borderRadius: borderRadius.full, borderWidth: 1.5,
    borderColor: colors.error, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  btnRejectText: { color: colors.error, fontWeight: '700', fontSize: typography.fontSizes.md },
  btnConfirmWrap: { flex: 2, borderRadius: borderRadius.full, overflow: 'hidden' },
  btnConfirm: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnConfirmText: { color: colors.white, fontWeight: '800', fontSize: typography.fontSizes.md },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: `${colors.primary}10`, borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textSecondary, lineHeight: 20 },
  btnHome: {
    borderRadius: borderRadius.full, borderWidth: 1.5,
    borderColor: colors.primary, paddingVertical: 14,
    alignItems: 'center',
  },
  btnHomeText: { color: colors.primary, fontWeight: '700', fontSize: typography.fontSizes.md },
  btnCancel: {
    paddingVertical: 14, alignItems: 'center',
  },
  btnCancelText: { color: colors.error, fontWeight: '600', fontSize: typography.fontSizes.sm, textDecorationLine: 'underline' },
});
