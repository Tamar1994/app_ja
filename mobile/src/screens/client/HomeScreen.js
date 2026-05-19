import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, StatusBar, ActivityIndicator, RefreshControl, Dimensions, Image,
  Modal, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { requestAPI, serviceTypeAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { suggestServiceType } from '../../services/serviceSuggestion';


const { width } = Dimensions.get('window');
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api').replace(/\/api\/?$/, '');

function buildImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

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
  const insets = useSafeAreaInsets();
  const [activeRequest, setActiveRequest] = useState(null);
  const [recentRequest, setRecentRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [smartSearchVisible, setSmartSearchVisible] = useState(false);
  const [smartPrompt, setSmartPrompt] = useState('');
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartSuggestion, setSmartSuggestion] = useState(null);
  const [smartError, setSmartError] = useState('');
  const pollRef = useRef(null);

  const loadActiveRequest = async () => {
    try {
      const { data } = await requestAPI.list();
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const activeStatuses = ['searching', 'accepted', 'preparing', 'on_the_way', 'in_progress'];
      const active = requests.find((r) =>
        activeStatuses.includes(r.status)
      );
      const repeatable = requests.find((r) =>
        !activeStatuses.includes(r.status)
        && r.serviceTypeSlug
        && r.details?.tierLabel
      ) || null;
      setActiveRequest(active || null);
      setRecentRequest(repeatable);
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

  const firstName = user?.name?.split(' ')[0] || 'Olá';

  const enabledServiceTypes = serviceTypes.filter((st) => st.status === 'enabled');
  const serviceTypeBySlug = (slug) => serviceTypes.find((st) => st.slug === slug) || null;

  const openSmartSearch = () => {
    setSmartPrompt('');
    setSmartSuggestion(null);
    setSmartError('');
    setSmartSearchVisible(true);
  };

  const runSmartSuggestion = async () => {
    if (!smartPrompt.trim()) {
      setSmartError('Digite o que você precisa.');
      return;
    }

    if (!enabledServiceTypes.length) {
      setSmartError('Nenhum serviço disponível no momento.');
      return;
    }

    setSmartLoading(true);
    setSmartError('');
    try {
      const result = await suggestServiceType(smartPrompt, enabledServiceTypes);
      setSmartSuggestion(result);
    } catch {
      setSmartError('Não foi possível sugerir um serviço agora.');
    } finally {
      setSmartLoading(false);
    }
  };

  const acceptSuggestion = () => {
    const serviceType = smartSuggestion?.serviceType;
    if (!serviceType?.slug) return;
    setSmartSearchVisible(false);
    navigation.navigate('RequestService', {
      serviceType,
      initialNotes: smartPrompt,
    });
  };

  const repeatLastRequest = async () => {
    if (!recentRequest?.serviceTypeSlug || !recentRequest?.details?.tierLabel) {
      Alert.alert('Sem pedido recente', 'Ainda não encontramos um pedido anterior para repetir.');
      return;
    }

    const serviceType = serviceTypeBySlug(recentRequest.serviceTypeSlug);
    if (!serviceType) {
      Alert.alert('Serviço indisponível', 'Não foi possível localizar o serviço deste pedido.');
      return;
    }

    const requestData = {
      serviceTypeSlug: recentRequest.serviceTypeSlug,
      tierLabel: recentRequest.details.tierLabel,
      selectedUpsells: Array.isArray(recentRequest.details.upsells) ? recentRequest.details.upsells : [],
      notes: recentRequest.details.notes || '',
      address: recentRequest.address || {},
      scheduledDate: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    try {
      const { data: estimate } = await requestAPI.estimate(
        requestData.serviceTypeSlug,
        requestData.tierLabel,
        requestData.selectedUpsells,
        requestData.scheduledDate,
      );

      navigation.navigate('Payment', {
        requestData,
        estimate,
        serviceType,
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível repetir esse pedido agora.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header com gradiente */}
      <LinearGradient
        colors={['#FF8C38', '#FF6B00', '#E55A00']}
        style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.greeting}>Olá, {firstName}! 👋</Text>
            <Text style={styles.headerSub}>O que você precisa hoje?</Text>
          </View>
          <TouchableOpacity style={styles.avatarBtn} onPress={() => navigation.navigate('ProfileTab')} activeOpacity={0.85}>
            {user?.avatar ? (
              <Image source={{ uri: buildImageUrl(user.avatar) }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Botão de solicitar no header */}
        {!activeRequest && !loading && (
          <TouchableOpacity
            style={styles.headerSearchBtn}
            onPress={openSmartSearch}
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

        {recentRequest ? (
          <View style={styles.repeatSection}>
            <View style={styles.repeatSectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Peça novamente</Text>
                <Text style={styles.repeatSubtitle}>Repetimos sua última solicitação com horário atualizado para agora.</Text>
              </View>
              <View style={styles.repeatBadge}>
                <Ionicons name="refresh-outline" size={14} color={colors.primary} />
                <Text style={styles.repeatBadgeText}>1 toque</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.repeatCard} onPress={repeatLastRequest} activeOpacity={0.88}>
              <View style={styles.repeatIconWrap}>
                <Ionicons name="repeat-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.repeatContent}>
                <Text style={styles.repeatTitle}>{recentRequest.serviceType?.name || serviceTypeBySlug(recentRequest.serviceTypeSlug)?.name || 'Serviço'}</Text>
                <Text style={styles.repeatText} numberOfLines={2}>
                  {recentRequest.details?.tierLabel || '-'} • {recentRequest.address?.city || 'Sua região'} • {' '}
                  {recentRequest.status === 'completed' ? 'pedido concluído' : 'último pedido'}
                </Text>
              </View>
              <View style={styles.repeatCta}>
                <Text style={styles.repeatCtaText}>Repetir</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.white} />
              </View>
            </TouchableOpacity>
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
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Como funciona</Text>
              <Text style={styles.sectionSubtitle}>Uma experiência pensada para ser rápida, clara e bonita.</Text>
            </View>
            <View style={styles.sectionBadge}>
              <Ionicons name="sparkles" size={14} color={colors.primary} />
              <Text style={styles.sectionBadgeText}>Fluxo premium</Text>
            </View>
          </View>

          <LinearGradient
            colors={['#FFFFFF', '#FFF7EF']}
            style={styles.howPanel}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.howPanelGlow} />
            {[
              { icon: 'clipboard-outline', title: 'Solicite', desc: 'Descreva o que precisa e o app entende o pedido.', color: '#FF8C38' },
              { icon: 'person-circle-outline', title: 'Conectamos', desc: 'O profissional certo recebe sua solicitação com prioridade.', color: '#2563EB' },
              { icon: 'checkmark-circle-outline', title: 'Pronto', desc: 'Acompanhe, confirme e finalize tudo no aplicativo.', color: '#16A34A' },
            ].map((step, index) => (
              <View key={step.title} style={styles.howStepRow}>
                <View style={styles.howStepRail}>
                  <View style={[styles.howStepDot, { backgroundColor: step.color }]} />
                  {index < 2 && <View style={styles.howStepLine} />}
                </View>
                <View style={styles.howStepCard}>
                  <View style={[styles.howStepIcon, { backgroundColor: `${step.color}12` }]}>
                    <Ionicons name={step.icon} size={22} color={step.color} />
                  </View>
                  <View style={styles.howStepText}>
                    <Text style={styles.howStepTitle}>{step.title}</Text>
                    <Text style={styles.howStepDesc}>{step.desc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </LinearGradient>
        </View>
      </ScrollView>

      <Modal
        visible={smartSearchVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSmartSearchVisible(false)}
      >
        <View style={styles.smartBackdrop}>
          <View style={styles.smartCard}>
            <View style={styles.smartHandle} />
            <Text style={styles.smartTitle}>O que você precisa hoje?</Text>
            <Text style={styles.smartSubtitle}>Digite em linguagem natural e eu sugiro o serviço ideal.</Text>

            <TextInput
              value={smartPrompt}
              onChangeText={setSmartPrompt}
              placeholder="Ex: preciso limpar a casa e passar roupa"
              placeholderTextColor={colors.textLight}
              style={styles.smartInput}
              multiline
            />

            {smartError ? <Text style={styles.smartError}>{smartError}</Text> : null}

            <TouchableOpacity style={styles.smartActionBtn} onPress={runSmartSuggestion} activeOpacity={0.9}>
              <LinearGradient colors={colors.gradientPrimary} style={styles.smartActionGradient}>
                {smartLoading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.smartActionText}>Sugerir serviço</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {smartSuggestion?.serviceType ? (
              <TouchableOpacity style={styles.smartSuggestionCard} onPress={acceptSuggestion} activeOpacity={0.85}>
                <View style={styles.smartSuggestionTop}>
                  <View>
                    <Text style={styles.smartSuggestionLabel}>Sugestão da IA</Text>
                    <Text style={styles.smartSuggestionTitle}>{smartSuggestion.serviceType.name}</Text>
                  </View>
                  <View style={styles.smartSuggestionPill}>
                    <Text style={styles.smartSuggestionPillText}>{Math.round((smartSuggestion.confidence || 0.5) * 100)}%</Text>
                  </View>
                </View>
                <Text style={styles.smartSuggestionText}>{smartSuggestion.explanation}</Text>
                <Text style={styles.smartSuggestionCta}>Agendar {smartSuggestion.serviceType.name}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.smartCloseBtn} onPress={() => setSmartSearchVisible(false)}>
              <Text style={styles.smartCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
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
  headerTextBlock: { flex: 1, paddingRight: spacing.md },
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
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.15)',
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
  repeatSection: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  repeatSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  repeatSubtitle: {
    marginTop: 4,
    color: colors.textLight,
    fontSize: typography.fontSizes.sm,
    lineHeight: 19,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: '#FFF1E6',
    borderWidth: 1,
    borderColor: '#FFD7B3',
  },
  repeatBadgeText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  repeatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 24,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: 'rgba(255,140,56,0.12)',
    ...shadows.md,
  },
  repeatIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#FFF3E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatContent: { flex: 1 },
  repeatTitle: { fontSize: typography.fontSizes.md, fontWeight: '800', color: colors.textPrimary },
  repeatText: { marginTop: 4, fontSize: typography.fontSizes.sm, color: colors.textSecondary, lineHeight: 18 },
  repeatCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.primary,
  },
  repeatCtaText: { color: colors.white, fontSize: 12, fontWeight: '800' },
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
  howSection: { gap: spacing.sm, marginTop: spacing.xs },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionSubtitle: {
    marginTop: 4,
    color: colors.textLight,
    fontSize: typography.fontSizes.sm,
    lineHeight: 19,
  },
  sectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFF1E6',
    borderWidth: 1,
    borderColor: '#FFD7B3',
  },
  sectionBadgeText: {
    color: '#C75A00',
    fontSize: 11,
    fontWeight: '700',
  },
  howPanel: {
    borderRadius: 28,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,140,56,0.14)',
    overflow: 'hidden',
    ...shadows.md,
  },
  howPanelGlow: {
    position: 'absolute',
    top: -30,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,140,56,0.08)',
  },
  howStepRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'stretch',
  },
  howStepRail: {
    width: 18,
    alignItems: 'center',
    paddingTop: 18,
  },
  howStepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.white,
    zIndex: 2,
  },
  howStepLine: {
    flex: 1,
    width: 2,
    backgroundColor: 'rgba(255,140,56,0.15)',
    marginTop: 6,
    borderRadius: 999,
  },
  howStepCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  howStepIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howStepText: { flex: 1 },
  howStepTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  howStepDesc: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginTop: 3,
    lineHeight: 19,
  },
  smartBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  smartCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 24,
    ...shadows.lg,
  },
  smartHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  smartTitle: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.textPrimary },
  smartSubtitle: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md },
  smartInput: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    backgroundColor: colors.background,
  },
  smartError: { color: colors.error, fontSize: typography.fontSizes.sm, marginTop: 8 },
  smartActionBtn: { marginTop: spacing.md, borderRadius: borderRadius.full, overflow: 'hidden' },
  smartActionGradient: { paddingVertical: 14, alignItems: 'center' },
  smartActionText: { color: colors.white, fontSize: typography.fontSizes.md, fontWeight: '700' },
  smartSuggestionCard: {
    marginTop: spacing.md,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.primary}20`,
    backgroundColor: `${colors.primary}08`,
  },
  smartSuggestionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  smartSuggestionLabel: { fontSize: typography.fontSizes.xs, color: colors.textLight, textTransform: 'uppercase', fontWeight: '700' },
  smartSuggestionTitle: { fontSize: typography.fontSizes.lg, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  smartSuggestionPill: {
    backgroundColor: `${colors.primary}12`,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  smartSuggestionPillText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  smartSuggestionText: { color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  smartSuggestionCta: { marginTop: 10, color: colors.primary, fontWeight: '800' },
  smartCloseBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: spacing.sm,
  },
  smartCloseText: { color: colors.textSecondary, fontWeight: '600' },
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
