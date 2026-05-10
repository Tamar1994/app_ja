import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const STATUS_META = {
  searching: { label: 'Buscando profissional', color: colors.primary, icon: 'search' },
  accepted: { label: 'Profissional confirmado', color: colors.secondary, icon: 'person-circle' },
  preparing: { label: 'Profissional se preparando', color: '#7C3AED', icon: 'construct' },
  on_the_way: { label: 'Profissional a caminho', color: '#2563EB', icon: 'car' },
  in_progress: { label: 'Serviço em andamento', color: colors.warning, icon: 'home' },
  completed: { label: 'Serviço concluído', color: colors.success, icon: 'checkmark-circle' },
  cancelled: { label: 'Serviço cancelado', color: colors.textLight, icon: 'close-circle' },
};

export default function RequestDetailsScreen({ navigation, route }) {
  const { requestId, role = 'client' } = route.params || {};
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRequest = useCallback(async () => {
    try {
      const { data } = await requestAPI.getById(requestId);
      setRequest(data.request || null);
    } catch {
      // noop
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  const statusMeta = useMemo(() => STATUS_META[request?.status] || {
    label: request?.status || 'Status',
    color: colors.textLight,
    icon: 'information-circle',
  }, [request?.status]);

  const isActive = ['searching', 'accepted', 'preparing', 'on_the_way', 'in_progress'].includes(request?.status);

  const handleOpenActiveFlow = () => {
    if (!request?._id) return;
    if (role === 'professional') {
      navigation.navigate('DashboardTab', { screen: 'ActiveJob', params: { requestId: request._id } });
      return;
    }
    if (request.status === 'searching') {
      navigation.navigate('HomeTab', { screen: 'Searching', params: { requestId: request._id } });
      return;
    }
    navigation.navigate('HomeTab', { screen: 'Tracking', params: { requestId: request._id } });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!request) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Text style={styles.emptyTitle}>Serviço não encontrado</Text>
        <TouchableOpacity style={styles.backOnlyBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backOnlyText}>Voltar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const serviceDate = new Date(request.details?.scheduledDate || request.createdAt || Date.now());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient colors={[statusMeta.color + 'CC', statusMeta.color]} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <View style={styles.headerIconWrap}>
            <Ionicons name={statusMeta.icon} size={30} color={colors.white} />
          </View>
          <Text style={styles.headerTitle}>Detalhes do serviço</Text>
          <Text style={styles.headerSub}>{statusMeta.label}</Text>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRequest(); }} colors={[colors.primary]} />}
      >
        <View style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.serviceName}>{request.serviceTypeName || 'Diarista'}</Text>
            <View style={[styles.badge, { backgroundColor: `${statusMeta.color}15` }]}>
              <Text style={[styles.badgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>
          <Text style={styles.dateText}>
            {serviceDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            {' · '}
            {serviceDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informações</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>ID do serviço</Text>
            <Text style={styles.infoValue}>#{String(request._id).slice(-6)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Duração</Text>
            <Text style={styles.infoValue}>{request.details?.hours || '-'}h</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Endereço</Text>
            <Text style={styles.infoValue}>
              {request.address?.street || '-'}{request.address?.city ? `, ${request.address.city}` : ''}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Valor total</Text>
            <Text style={styles.infoValue}>R$ {Number(request.pricing?.estimated || 0).toFixed(2)}</Text>
          </View>
          {role === 'professional' && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Seu ganho</Text>
              <Text style={[styles.infoValue, styles.earningValue]}>R$ {(Number(request.pricing?.estimated || 0) * 0.85).toFixed(2)}</Text>
            </View>
          )}
          {request.details?.notes ? (
            <View style={styles.notesWrap}>
              <Text style={styles.notesTitle}>Observações</Text>
              <Text style={styles.notesText}>{request.details.notes}</Text>
            </View>
          ) : null}
        </View>

        {isActive && (
          <TouchableOpacity style={styles.actionBtnWrap} onPress={handleOpenActiveFlow}>
            <LinearGradient colors={colors.gradientPrimary} style={styles.actionBtn}>
              <Ionicons name="open-outline" size={18} color={colors.white} />
              <Text style={styles.actionBtnText}>
                {role === 'professional' ? 'Abrir serviço ativo' : 'Acompanhar serviço'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: 50,
    paddingBottom: 26,
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
  headerBody: { alignItems: 'center' },
  headerIconWrap: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.sm,
  },
  headerTitle: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.white },
  headerSub: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 36 },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.md,
    gap: spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  serviceName: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  dateText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  badge: { borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: typography.fontSizes.xs, fontWeight: '700' },
  sectionTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingBottom: 10,
    marginBottom: 2,
  },
  infoLabel: { fontSize: typography.fontSizes.sm, color: colors.textLight, flex: 1 },
  infoValue: { fontSize: typography.fontSizes.sm, color: colors.textPrimary, flex: 1.3, textAlign: 'right' },
  earningValue: { color: colors.success, fontWeight: '800' },
  notesWrap: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    backgroundColor: `${colors.primary}08`,
    borderRadius: borderRadius.md,
  },
  notesTitle: { fontSize: typography.fontSizes.xs, color: colors.textLight, marginBottom: 4, fontWeight: '700' },
  notesText: { fontSize: typography.fontSizes.sm, color: colors.textPrimary, lineHeight: 20 },
  actionBtnWrap: { marginTop: spacing.xs },
  actionBtn: {
    borderRadius: borderRadius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnText: { color: colors.white, fontSize: typography.fontSizes.md, fontWeight: '700' },
  emptyTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: typography.fontSizes.lg },
  backOnlyBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backOnlyText: { color: colors.textSecondary, fontWeight: '600' },
});