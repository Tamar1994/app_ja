import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function ProfessionalHistoryScreen() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await requestAPI.list('my-services');
      setRequests(data.requests || []);
    } catch {
      // ignora
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const STATUS_COLORS = {
    accepted: colors.secondary,
    in_progress: colors.warning,
    completed: colors.success,
  };
  const STATUS_LABELS = {
    accepted: 'Aguardando cliente',
    in_progress: 'Em andamento',
    completed: 'Finalizado',
  };
  const STATUS_ICONS = {
    accepted: 'hourglass-outline',
    in_progress: 'home',
    completed: 'checkmark-circle',
  };

  const waitingRequests = requests.filter((item) => item.status === 'accepted');
  const activeRequests = requests.filter((item) => item.status === 'in_progress');
  const completedRequests = requests.filter((item) => item.status === 'completed');

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardService}>
          <View style={styles.cardServiceIcon}>
            <Ionicons name="home" size={18} color={colors.secondary} />
          </View>
          <View>
            <Text style={styles.cardServiceText}>Diarista</Text>
            <Text style={{ fontSize: typography.fontSizes.xs, color: colors.textLight }}>
              {new Date(item.details.scheduledDate).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Text>
          </View>
        </View>
        <View style={[styles.badge, { backgroundColor: `${STATUS_COLORS[item.status]}15` }]}>
          <Ionicons name={STATUS_ICONS[item.status]} size={12} color={STATUS_COLORS[item.status]} />
          <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.cardBottom}>
        <View style={styles.cardDetail}>
          <Ionicons name="time-outline" size={14} color={colors.textLight} />
          <Text style={styles.cardDetailText}>{item.details.hours}h</Text>
        </View>
        <View style={styles.cardDetail}>
          <Ionicons name="location-outline" size={14} color={colors.textLight} />
          <Text style={styles.cardDetailText}>{item.address.city}</Text>
        </View>
        {item.status === 'completed' && (
          <Text style={styles.cardEarnings}>
            +R$ {(item.pricing.estimated * 0.85).toFixed(2)}
          </Text>
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </SafeAreaView>
    );
  }

  const sections = [
    { key: 'active', title: 'Serviço ativo', data: activeRequests },
    { key: 'waiting', title: 'Aguardando aceite do cliente', data: waitingRequests },
    { key: 'completed', title: 'Histórico de finalizadas', data: completedRequests },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientSecondary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.headerTitle}>Meus serviços</Text>
        <Text style={styles.headerSub}>{requests.length} serviço{requests.length !== 1 ? 's' : ''}</Text>
      </LinearGradient>
      <FlatList
        data={sections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[colors.secondary]}
          />
        }
        renderItem={({ item: section }) => (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.data.length ? section.data.map((request) => (
              <View key={request._id} style={styles.sectionItemWrap}>
                {renderItem({ item: request })}
              </View>
            )) : (
              <View style={styles.sectionEmpty}>
                <Text style={styles.sectionEmptyText}>Nenhum serviço nesta etapa.</Text>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="briefcase-outline" size={36} color={colors.textLight} />
            </View>
            <Text style={styles.emptyTitle}>Nenhum serviço ainda</Text>
            <Text style={styles.emptyText}>Quando você aceitar pedidos, eles aparecerão aqui</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 55,
    paddingBottom: 20,
    paddingHorizontal: spacing.lg,
  },
  headerTitle: { fontSize: typography.fontSizes.xxl, fontWeight: '800', color: colors.white },
  headerSub: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 90 },
  sectionBlock: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  sectionItemWrap: { marginTop: spacing.xs },
  sectionEmpty: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionEmptyText: { fontSize: typography.fontSizes.sm, color: colors.textLight },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadows.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  cardService: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  cardServiceText: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  cardServiceIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: `${colors.secondary}15`, alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 5,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cardDivider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.md },
  cardBottom: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, gap: spacing.md,
  },
  cardDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDetailText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  cardEarnings: {
    marginLeft: 'auto',
    fontSize: typography.fontSizes.lg, fontWeight: '800', color: colors.success,
  },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.border,
  },
  emptyTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: typography.fontSizes.md, color: colors.textLight },
});
