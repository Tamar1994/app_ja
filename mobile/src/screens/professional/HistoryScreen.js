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
      const { data } = await requestAPI.list();
      // Filtrar apenas os serviços do profissional (aceitos, em andamento, concluídos, cancelados)
      const done = data.requests.filter((r) =>
        ['accepted', 'in_progress', 'completed', 'cancelled'].includes(r.status)
      );
      setRequests(done);
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
    cancelled: colors.textLight,
  };
  const STATUS_LABELS = {
    accepted: 'Aceito',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  };
  const STATUS_ICONS = {
    accepted: 'walk',
    in_progress: 'home',
    completed: 'checkmark-circle',
    cancelled: 'close-circle',
  };

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
        data={requests}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[colors.secondary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="briefcase-outline" size={36} color={colors.textLight} />
            </View>
            <Text style={styles.emptyTitle}>Nenhum serviço ainda</Text>
            <Text style={styles.emptyText}>Seus serviços realizados aparecerão aqui</Text>
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
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 90 },
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
