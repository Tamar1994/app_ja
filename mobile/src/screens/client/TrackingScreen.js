import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSocket } from '../../context/SocketContext';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const STEPS = [
  { status: 'accepted', label: 'Profissional a caminho', icon: 'walk', color: colors.secondary },
  { status: 'in_progress', label: 'Serviço em andamento', icon: 'home', color: colors.warning },
  { status: 'completed', label: 'Serviço concluído!', icon: 'checkmark-circle', color: colors.success },
];

export default function TrackingScreen({ navigation, route }) {
  const { requestId } = route.params;
  const { on } = useSocket();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequest();
    const unsubStart = on('service_started', ({ requestId: id }) => { if (id === requestId) loadRequest(); });
    const unsubComplete = on('service_completed', ({ requestId: id }) => { if (id === requestId) loadRequest(); });
    return () => { unsubStart && unsubStart(); unsubComplete && unsubComplete(); };
  }, [requestId]);

  const loadRequest = async () => {
    try {
      const { data } = await requestAPI.getById(requestId);
      setRequest(data.request);
      if (data.request.status === 'completed') {
        navigation.replace('Review', { requestId, professionalName: data.request.professional?.name });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar o serviço.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('Cancelar serviço', 'Deseja cancelar este serviço?', [
      { text: 'Não' },
      { text: 'Cancelar serviço', style: 'destructive', onPress: async () => {
        try {
          await requestAPI.cancel(requestId, 'Cancelado pelo cliente');
          navigation.replace('Home');
        } catch { Alert.alert('Erro', 'Não foi possível cancelar.'); }
      }},
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.status === request?.status);
  const currentStep = STEPS[Math.max(currentStepIndex, 0)];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Gradient header com status */}
      <LinearGradient
        colors={[currentStep.color + 'CC', currentStep.color]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerIconWrap}>
            <Ionicons name={currentStep.icon} size={32} color={colors.white} />
          </View>
          <Text style={styles.headerTitle}>{currentStep.label}</Text>
          <Text style={styles.headerSub}>Acompanhe seu serviço em tempo real</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Timeline */}
        <View style={styles.timelineCard}>
          <Text style={styles.cardLabel}>Progresso</Text>
          {STEPS.map((step, i) => {
            const done = i <= currentStepIndex;
            const active = i === currentStepIndex;
            return (
              <View key={step.status} style={styles.timelineRow}>
                <View style={styles.timelineLeft}>
                  <View style={[
                    styles.timelineDot,
                    done && { backgroundColor: step.color, borderColor: step.color },
                    !done && styles.timelineDotPending,
                  ]}>
                    {done
                      ? <Ionicons name="checkmark" size={13} color={colors.white} />
                      : <View style={styles.timelineDotInner} />}
                  </View>
                  {i < STEPS.length - 1 && (
                    <View style={[styles.connector, done && { backgroundColor: STEPS[i + 1].color + '80' }]} />
                  )}
                </View>
                <View style={styles.timelineTextWrap}>
                  <Text style={[styles.timelineLabel, done && { color: colors.textPrimary, fontWeight: '700' }]}>
                    {step.label}
                  </Text>
                  {active && (
                    <View style={[styles.activePill, { backgroundColor: step.color + '15' }]}>
                      <Text style={[styles.activePillText, { color: step.color }]}>Em andamento</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Card do profissional */}
        {request?.professional && (
          <View style={styles.proCard}>
            <View style={styles.proAvatarWrap}>
              <LinearGradient colors={colors.gradientSecondary} style={styles.proAvatar}>
                <Text style={styles.proAvatarText}>{request.professional.name[0]}</Text>
              </LinearGradient>
              <View style={styles.proOnline} />
            </View>
            <View style={styles.proInfo}>
              <Text style={styles.proName}>{request.professional.name}</Text>
              <View style={styles.proRating}>
                <Ionicons name="star" size={14} color={colors.warning} />
                <Text style={styles.proRatingText}>
                  {request.professional.professional?.rating?.toFixed(1) || '5.0'} • Diarista
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.callBtn}>
              <LinearGradient colors={colors.gradientSecondary} style={styles.callBtnGradient}>
                <Ionicons name="call" size={18} color={colors.white} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Detalhes do serviço */}
        {request && (
          <View style={styles.detailsCard}>
            <Text style={styles.cardLabel}>Detalhes</Text>
            {[
              { label: 'Duração', value: `${request.details.hours}h`, icon: 'time-outline' },
              { label: 'Endereço', value: `${request.address.street}, ${request.address.city}`, icon: 'location-outline' },
              { label: 'Total estimado', value: `R$ ${request.pricing.estimated.toFixed(2)}`, icon: 'cash-outline', highlight: true },
            ].map((row, i) => (
              <View key={i} style={[styles.detailRow, i < 2 && styles.detailRowBorder]}>
                <View style={styles.detailIcon}>
                  <Ionicons name={row.icon} size={18} color={colors.primary} />
                </View>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={[styles.detailValue, row.highlight && styles.detailValueHighlight]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {request?.status === 'accepted' && (
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
            <Ionicons name="close-circle-outline" size={20} color={colors.error} />
            <Text style={styles.cancelText}>Cancelar serviço</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 50,
    paddingBottom: 28,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  headerContent: { alignItems: 'center' },
  headerIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
    gap: spacing.md,
  },
  cardLabel: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
    color: colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  // Timeline
  timelineCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineLeft: { alignItems: 'center', marginRight: spacing.md, width: 28 },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  timelineDotPending: { borderColor: colors.border },
  timelineDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  connector: {
    width: 2,
    height: 36,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  timelineTextWrap: { flex: 1, paddingTop: 4, paddingBottom: 20 },
  timelineLabel: { fontSize: typography.fontSizes.md, color: colors.textLight },
  activePill: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  activePillText: { fontSize: 11, fontWeight: '700' },
  // Professional card
  proCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.md,
  },
  proAvatarWrap: { position: 'relative' },
  proAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proAvatarText: { color: colors.white, fontSize: typography.fontSizes.xl, fontWeight: '700' },
  proOnline: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.white,
  },
  proInfo: { flex: 1 },
  proName: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  proRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  proRatingText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  callBtn: { borderRadius: 22, overflow: 'hidden' },
  callBtnGradient: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  // Details
  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: spacing.sm,
  },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFF0E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLabel: { flex: 1, fontSize: typography.fontSizes.md, color: colors.textSecondary },
  detailValue: { fontSize: typography.fontSizes.md, fontWeight: '600', color: colors.textPrimary },
  detailValueHighlight: { color: colors.primary, fontSize: typography.fontSizes.lg, fontWeight: '800' },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.error + '50',
    borderRadius: borderRadius.full,
    paddingVertical: 14,
    backgroundColor: colors.error + '08',
  },
  cancelText: { color: colors.error, fontWeight: '600', fontSize: typography.fontSizes.md },
});

