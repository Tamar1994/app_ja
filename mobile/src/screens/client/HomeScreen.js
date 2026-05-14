import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, StatusBar, ActivityIndicator, RefreshControl, Dimensions, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { requestAPI, serviceTypeAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';


const { width } = Dimensions.get('window');
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api').replace(/\/api\/?$/, '');

const STATUS_LABELS = {
  searching: 'Buscando profissional...',
  accepted: 'Profissional confirmado',
  preparing: 'Profissional se preparando',
  on_the_way: 'Profissional a caminho',
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

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const { on } = useSocket();
  const [activeRequest, setActiveRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serviceTypes, setServiceTypes] = useState([]);
  const pollRef = useRef(null);

  const loadActiveRequest = async () => {
    try {
      const { data } = await requestAPI.list();
      const active = data.requests.find((r) =>
        ['searching', 'accepted', 'preparing', 'on_the_way', 'in_progress'].includes(r.status)
      );
      setActiveRequest(active || null);
      return active;
    } catch {
      // sem requisição ativa
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    return null;
  };

  const loadServiceTypes = async () => {
    try {
      const { data } = await serviceTypeAPI.list();
      setServiceTypes(data.serviceTypes || []);
    } catch {
      // mantém lista vazia — cards não aparecem
    }
  };

  useEffect(() => {
    loadActiveRequest();
    loadServiceTypes();

    // Ouvir aceite em tempo real
    const unsubAccepted = on('request_accepted', ({ request }) => {
      setActiveRequest(request);
      // Se estiver em Searching, navegar para Tracking
      navigation.navigate('Tracking', { requestId: request._id });
    });

    // Ouvir atualizações de status
    const unsubUpdated = on('request_status_updated', ({ request }) => {
      setActiveRequest(prev => {
        if (prev && prev._id === request._id) return request;
        return prev;
      });
    });

    // Polling a cada 30s como fallback quando socket perde conexão
    pollRef.current = setInterval(loadActiveRequest, 30000);

    return () => {
      unsubAccepted && unsubAccepted();
      unsubUpdated && unsubUpdated();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const onRefresh = () => { setRefreshing(true); loadActiveRequest(); loadServiceTypes(); };

  const firstName = user.name.split(' ')[0];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header com gradiente */}
      <LinearGradient
        colors={['#FF8C38', '#FF6B00', '#E55A00']}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Olá, {firstName}! 👋</Text>
            <Text style={styles.headerSub}>O que você precisa hoje?</Text>
          </View>
          <TouchableOpacity style={styles.avatarBtn} onPress={() => navigation.navigate('ProfileTab')}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{user.name[0].toUpperCase()}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Botão de solicitar no header */}
        {!activeRequest && !loading && (
          <TouchableOpacity
            style={styles.headerSearchBtn}
            onPress={() => navigation.navigate('RequestService')}
            activeOpacity={0.9}
          >
            <Ionicons name="search-outline" size={18} color={colors.textLight} />
            <Text style={styles.headerSearchText}>Contratar serviço...</Text>
          </TouchableOpacity>
        )}
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : activeRequest ? (
          /* Card de serviço ativo */
          <View style={styles.activeCard}>
            <View style={styles.activeCardTop}>
              <View style={[styles.activeStatusPill, { backgroundColor: `${STATUS_COLORS[activeRequest.status]}15` }]}>
                <View style={[styles.activeDot, { backgroundColor: STATUS_COLORS[activeRequest.status] }]} />
                <Text style={[styles.activeStatusText, { color: STATUS_COLORS[activeRequest.status] }]}>
                  {STATUS_LABELS[activeRequest.status]}
                </Text>
              </View>
              <Ionicons
                name={STATUS_ICONS[activeRequest.status]}
                size={22}
                color={STATUS_COLORS[activeRequest.status]}
              />
            </View>

            <Text style={styles.activeTitle}>{activeRequest.serviceType?.name || 'Serviço'}</Text>
            <Text style={styles.activeDetail}>
              {activeRequest.details.tierLabel || '-'} • {new Date(activeRequest.details.scheduledDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </Text>

            <View style={styles.activeDivider} />

            <View style={styles.activeBottom}>
              <View>
                <Text style={styles.activePriceLabel}>Total estimado</Text>
                <Text style={styles.activePrice}>R$ {activeRequest.pricing.estimated.toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                style={styles.btnTrack}
                onPress={() => {
                  if (activeRequest.status === 'searching') {
                    navigation.navigate('Searching', { requestId: activeRequest._id });
                  } else {
                    navigation.navigate('Tracking', { requestId: activeRequest._id });
                  }
                }}
              >
                <LinearGradient
                  colors={colors.gradientPrimary}
                  style={styles.btnTrackGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Text style={styles.btnTrackText}>
                    {activeRequest.status === 'searching' ? 'Ver busca' : 'Acompanhar'}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.white} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Serviços */}
        <Text style={styles.sectionTitle}>Serviços</Text>
        <View style={styles.servicesGrid}>
          {serviceTypes.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : serviceTypes.map((st) => {
            const enabled = st.status === 'enabled';
            return enabled ? (
              <TouchableOpacity
                key={st._id}
                style={styles.serviceCard}
                onPress={() => navigation.navigate('RequestService', { serviceType: st })}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#FFF3E8', '#FFE0C3']}
                  style={styles.serviceCardGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.serviceIconBg}>
                    {st.imageUrl ? (
                      <Image source={{ uri: `${API_BASE}${st.imageUrl}` }} style={styles.serviceIconImage} resizeMode="contain" />
                    ) : (
                      <Ionicons name={st.icon || 'briefcase-outline'} size={28} color={colors.primary} />
                    )}
                  </View>
                  <Text style={styles.serviceCardTitle}>{st.name}</Text>
                  <Text style={styles.serviceCardSub}>{st.description || ''}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <View key={st._id} style={[styles.serviceCard, styles.serviceCardSoon]}>
                <View style={styles.serviceCardGradient}>
                  <View style={[styles.serviceIconBg, { backgroundColor: 'rgba(0,0,0,0.05)' }]}>
                    {st.imageUrl ? (
                      <Image source={{ uri: `${API_BASE}${st.imageUrl}` }} style={styles.serviceIconImage} resizeMode="contain" />
                    ) : (
                      <Ionicons name={st.icon || 'briefcase-outline'} size={28} color={colors.textLight} />
                    )}
                  </View>
                  <Text style={[styles.serviceCardTitle, { color: colors.textLight }]}>{st.name}</Text>
                  <View style={styles.soonBadge}>
                    <Text style={styles.soonText}>Em breve</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Como funciona */}
        <View style={styles.howSection}>
          <Text style={styles.sectionTitle}>Como funciona</Text>
          {[
            { icon: 'clipboard-outline', label: '1. Solicite', desc: 'Informe horas, cômodos e endereço', color: '#FFF0E6' },
            { icon: 'person-circle-outline', label: '2. Conectamos', desc: 'Um profissional próximo aceita o pedido', color: '#E8F0FE' },
            { icon: 'checkmark-circle-outline', label: '3. Pronto!', desc: 'Acompanhe em tempo real e pague pelo app', color: '#E8F5E9' },
          ].map((step, i) => (
            <View key={i} style={styles.howCard}>
              <View style={[styles.howIcon, { backgroundColor: step.color }]}>
                <Ionicons name={step.icon} size={24} color={colors.primary} />
              </View>
              <View style={styles.howText}>
                <Text style={styles.howLabel}>{step.label}</Text>
                <Text style={styles.howDesc}>{step.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  greeting: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.3,
  },
  headerSub: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  avatarBtn: {},
  avatarPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { color: colors.white, fontSize: typography.fontSizes.lg, fontWeight: '700' },
  headerSearchBtn: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.md,
  },
  headerSearchText: { color: colors.textLight, fontSize: typography.fontSizes.md },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 90 },
  // Active card
  activeCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.lg,
  },
  activeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  activeStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  activeStatusText: { fontSize: typography.fontSizes.sm, fontWeight: '600' },
  activeTitle: { fontSize: typography.fontSizes.xxl, fontWeight: '800', color: colors.textPrimary },
  activeDetail: { fontSize: typography.fontSizes.md, color: colors.textSecondary, marginTop: 2 },
  activeDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  activeBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activePriceLabel: { fontSize: typography.fontSizes.xs, color: colors.textLight, fontWeight: '500' },
  activePrice: { fontSize: typography.fontSizes.xxl, fontWeight: '800', color: colors.primary },
  btnTrack: { borderRadius: borderRadius.full, overflow: 'hidden' },
  btnTrackGradient: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  btnTrackText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.sm },
  // Services
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  servicesGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  serviceCard: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.sm,
  },
  serviceCardSoon: { opacity: 0.6 },
  serviceCardGradient: {
    padding: spacing.md,
    minHeight: 130,
    justifyContent: 'space-between',
  },
  serviceIconBg: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,107,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  serviceIconImage: {
    width: 30,
    height: 30,
  },
  serviceCardTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  serviceCardSub: { fontSize: typography.fontSizes.xs, color: colors.primary, fontWeight: '600', marginTop: 2 },
  soonBadge: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  soonText: { fontSize: 10, color: colors.textLight, fontWeight: '600' },
  // How it works
  howSection: { gap: spacing.sm },
  howCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.sm,
  },
  howIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howText: { flex: 1 },
  howLabel: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  howDesc: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 2 },
});
