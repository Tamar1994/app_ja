import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatHours } from '../../utils/format';

const STATUS_LABELS = {
  searching: 'Buscando',
  accepted: 'Aceito',
  preparing: 'Se preparando',
  on_the_way: 'A caminho',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};
const STATUS_COLORS = {
  searching: colors.primary,
  accepted: colors.secondary,
  preparing: '#7C3AED',
  on_the_way: '#2563EB',
  in_progress: colors.warning,
  completed: colors.success,
  cancelled: colors.textLight,
};
const STATUS_ICONS = {
  searching: 'search',
  accepted: 'person-circle',
  preparing: 'construct',
  on_the_way: 'car',
  in_progress: 'home',
  completed: 'checkmark-circle',
  cancelled: 'close-circle',
};

export default function HistoryScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await requestAPI.list();
      setRequests(data.requests);
    } catch {
      // ignora
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const renderItem = ({ item }) => {
    const isActive = ['searching', 'accepted', 'preparing', 'on_the_way', 'in_progress'].includes(item.status);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (item.status === 'searching') {
            navigation.navigate('HomeTab', { screen: 'Searching', params: { requestId: item._id } });
            return;
          }
          if (['accepted', 'preparing', 'on_the_way', 'in_progress'].includes(item.status)) {
            navigation.navigate('HomeTab', { screen: 'Tracking', params: { requestId: item._id } });
            return;
          }
          navigation.navigate('HomeTab', { screen: 'RequestDetails', params: { requestId: item._id, role: 'client' } });
        }}
        activeOpacity={0.85}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardIconWrap}>
            <Ionicons name="home" size={22} color={colors.primary} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardService}>{item.serviceType?.name || 'Serviço'}</Text>
            <Text style={styles.cardDate}>
              {new Date(item.details.scheduledDate).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] + '15' }]}>
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
            <Text style={styles.cardDetailText}>{formatHours(item.details.hours)}</Text>
          </View>
          {item.professional && (
            <View style={styles.cardDetail}>
              <Ionicons name="person-outline" size={14} color={colors.textLight} />
              <Text style={styles.cardDetailText}>{item.professional.name.split(' ')[0]}</Text>
            </View>
          )}
          <Text style={styles.cardPrice}>R$ {item.pricing.estimated.toFixed(2)}</Text>
        </View>

        {isActive ? (
          <View style={styles.trackBanner}>
            <Text style={styles.trackBannerText}>Toque para acompanhar →</Text>
          </View>
        ) : (
          <View style={styles.trackBanner}>
            <Text style={styles.trackBannerText}>Toque para ver detalhes →</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.headerTitle}>Meus pedidos</Text>
        <Text style={styles.headerSub}>{requests.length} {requests.length === 1 ? 'solicitação' : 'solicitações'}</Text>
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
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="time-outline" size={40} color={colors.textLight} />
            </View>
            <Text style={styles.emptyTitle}>Nenhum pedido ainda</Text>
            <Text style={styles.emptyText}>Seus pedidos aparecerão aqui</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
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
    ...shadows.md,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF0E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1 },
  cardService: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  cardDate: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cardDivider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.md },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  cardDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDetailText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  cardPrice: {
    marginLeft: 'auto',
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.primary,
  },
  trackBanner: {
    backgroundColor: colors.primary + '12',
    paddingVertical: 8,
    alignItems: 'center',
  },
  trackBannerText: { fontSize: typography.fontSizes.sm, color: colors.primary, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: typography.fontSizes.md, color: colors.textLight },
});

