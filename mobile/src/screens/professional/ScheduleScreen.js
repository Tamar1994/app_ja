import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, SafeAreaView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';

import { colors, spacing, typography, borderRadius } from '../../theme';
import { requestAPI } from '../../services/api';

const STATUS_LABELS = {
  scheduled: 'Agendado',
  accepted: 'Aceito',
  preparing: 'Se preparando',
  on_the_way: 'A caminho',
  in_progress: 'Em andamento',
};
const STATUS_COLORS = {
  scheduled: '#7C3AED',
  accepted: colors.secondary,
  preparing: '#7C3AED',
  on_the_way: '#2563EB',
  in_progress: colors.warning,
};

function groupByDate(requests) {
  const groups = {};
  for (const req of requests) {
    const d = new Date(req.details?.scheduledDate);
    const key = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(req);
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

export default function ScheduleScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await requestAPI.mySchedule();
      const sorted = (res.data.requests || []).sort(
        (a, b) => new Date(a.details?.scheduledDate) - new Date(b.details?.scheduledDate)
      );
      setGroups(groupByDate(sorted));
    } catch (e) {
      console.warn('ScheduleScreen load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePress = (item) => {
    if (['in_progress', 'on_the_way', 'preparing', 'accepted'].includes(item.status)) {
      navigation.navigate('DashboardTab', { screen: 'ActiveJob', params: { requestId: item._id } });
    } else {
      navigation.navigate('DashboardTab', { screen: 'RequestDetails', params: { requestId: item._id, role: 'professional' } });
    }
  };

  const renderCard = (item) => {
    const color = STATUS_COLORS[item.status] || colors.primary;
    const label = STATUS_LABELS[item.status] || item.status;
    const date = new Date(item.details?.scheduledDate);
    return (
      <TouchableOpacity key={item._id} style={styles.card} onPress={() => handlePress(item)} activeOpacity={0.85}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardTime}>
            {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <View style={[styles.dot, { backgroundColor: color }]} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardClient}>{item.client?.name || 'Cliente'}</Text>
            <View style={[styles.badge, { backgroundColor: color + '20' }]}>
              <Text style={[styles.badgeText, { color }]}>{label}</Text>
            </View>
          </View>
          <Text style={styles.cardService}>{item.serviceType?.name || 'Serviço'}</Text>
          {item.details?.tierLabel && (
            <Text style={styles.cardTier}>{item.details.tierLabel}</Text>
          )}
          <View style={styles.cardRow}>
            <Ionicons name="location-outline" size={13} color={colors.textLight} />
            <Text style={styles.cardAddress} numberOfLines={1}>
              {item.address?.street}, {item.address?.city}
            </Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>
            R$ {((item.pricing?.estimated || 0) * (1 - (item.pricing?.platformFeePercent || 15) / 100)).toFixed(0)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ marginTop: 4 }} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderGroup = ({ item: group }) => (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{group.date}</Text>
        <Text style={styles.groupCount}>{group.items.length} {group.items.length === 1 ? 'serviço' : 'serviços'}</Text>
      </View>
      {group.items.map(renderCard)}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.white} />

      <LinearGradient colors={[colors.primary, colors.primaryDark || '#C0392B']} style={styles.header}>
        <Text style={styles.headerTitle}>Minha Agenda</Text>
        <Text style={styles.headerSub}>
          {groups.reduce((acc, g) => acc + g.items.length, 0)} agendamento(s)
        </Text>
      </LinearGradient>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={56} color={colors.textLight} />
          <Text style={styles.emptyTitle}>Nenhum agendamento confirmado</Text>
          <Text style={styles.emptySub}>Aceite pedidos de agendamento na aba Serviços</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.date}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 55, paddingBottom: 20, paddingHorizontal: spacing.lg,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.white },
  headerSub: { fontSize: 13, color: colors.white + 'CC', marginTop: 2 },
  list: { paddingBottom: 32 },
  group: { marginTop: spacing.lg },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider, marginBottom: spacing.sm,
  },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.primary, textTransform: 'capitalize' },
  groupCount: { fontSize: 12, color: colors.textLight },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardLeft: { alignItems: 'center', width: 48, marginRight: spacing.sm },
  cardTime: { fontSize: 13, fontWeight: '700', color: colors.text },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  cardClient: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  badge: { borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 6 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  cardService: { fontSize: 12, color: colors.textLight, marginBottom: 1 },
  cardTier: { fontSize: 12, color: colors.primary, fontWeight: '600', marginBottom: 3 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardAddress: { fontSize: 11, color: colors.textLight, flex: 1 },
  cardRight: { alignItems: 'flex-end', justifyContent: 'center', paddingLeft: spacing.sm },
  cardPrice: { fontSize: 14, fontWeight: '700', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: 13, color: colors.textLight, textAlign: 'center' },
});
