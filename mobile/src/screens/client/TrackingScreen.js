import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSocket } from '../../context/SocketContext';
import { requestAPI, serviceChatAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatDuration } from '../../utils/format';

const STEPS = [
  { status: 'accepted', label: 'Profissional confirmado', icon: 'person-circle', color: colors.secondary },
  { status: 'preparing', label: 'Profissional se preparando', icon: 'construct', color: '#7C3AED' },
  { status: 'on_the_way', label: 'Profissional a caminho', icon: 'car', color: '#2563EB' },
  { status: 'in_progress', label: 'Serviço em andamento', icon: 'home', color: colors.warning },
  { status: 'completed', label: 'Serviço concluído!', icon: 'checkmark-circle', color: colors.success },
];

const LIVE_POLL_MS = 10000;
const AVG_SPEED_KMH = 28;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toValidCoordinatePair(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = toFiniteNumber(coords[0]);
  const lat = toFiniteNumber(coords[1]);
  if (lng === null || lat === null) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  if (Math.abs(lng) < 0.0001 && Math.abs(lat) < 0.0001) return null;
  return { latitude: lat, longitude: lng };
}

function formatUpdatedAtLabel(value) {
  if (!value) return 'Aguardando primeira posição';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Aguardando primeira posição';
  return `Atualizado ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function TrackingScreen({ navigation, route }) {
  const { requestId } = route.params;
  const { on } = useSocket();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [geocodedClientCoords, setGeocodedClientCoords] = useState(null);
  const [unreadChat, setUnreadChat] = useState(0);
  const lastSeenPeerMsgCount = useRef(null);
  const chatPollRef = useRef(null);
  const geocodingAttempted = useRef(false);
  const mapRef = useRef(null);

  // Polling para badges de mensagens não lidas do profissional
  const checkChatUnread = async () => {
    try {
      const res = await serviceChatAPI.getByRequest(requestId);
      const msgs = res.data.chat?.messages || [];
      const peerCount = msgs.filter(m => m.sender === 'professional').length;
      if (lastSeenPeerMsgCount.current === null) {
        lastSeenPeerMsgCount.current = peerCount;
      } else if (peerCount > lastSeenPeerMsgCount.current) {
        setUnreadChat(peerCount - lastSeenPeerMsgCount.current);
      }
    } catch {}
  };

  useEffect(() => {
    chatPollRef.current = setInterval(checkChatUnread, 15000);
    return () => clearInterval(chatPollRef.current);
  }, [requestId]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      if (!mounted) return;
      await loadRequest();
    };

    refresh();

    const unsubStatus = on('request_status_updated', ({ request: updated }) => {
      if (updated?._id?.toString() === requestId?.toString()) {
        setRequest((prev) => ({
          ...(prev || {}),
          ...(updated || {}),
          professional: (updated && typeof updated.professional === 'object')
            ? updated.professional
            : prev?.professional || updated?.professional,
        }));
      }
    });
    const unsubLoc = on('professional_location_update', ({ requestId: id, longitude, latitude, updatedAt }) => {
      if (id?.toString() !== requestId?.toString()) return;
      setRequest((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          professionalLiveLocation: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          professionalLiveLocationUpdatedAt: updatedAt,
        };
      });
    });
    const unsubStart = on('service_started', ({ requestId: id }) => { if (id?.toString() === requestId?.toString()) refresh(); });
    const unsubComplete = on('service_completed', ({ requestId: id }) => { if (id?.toString() === requestId?.toString()) refresh(); });

    const interval = setInterval(refresh, LIVE_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
      unsubStatus && unsubStatus();
      unsubLoc && unsubLoc();
      unsubStart && unsubStart();
      unsubComplete && unsubComplete();
    };
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

  const currentStepIndex = Math.max(0, STEPS.findIndex((s) => s.status === request?.status));
  const currentStep = STEPS[Math.max(currentStepIndex, 0)] || STEPS[0];

  // Geocodificar endereço do pedido quando as coordenadas salvas forem inválidas (ex: [0,0])
  useEffect(() => {
    if (!request?.address) return;
    const fromDB = toValidCoordinatePair(request.address.coordinates);
    if (fromDB) {
      setGeocodedClientCoords(fromDB);
      return;
    }
    if (geocodingAttempted.current) return;
    geocodingAttempted.current = true;

    const addressText = [
      request.address.street,
      request.address.neighborhood,
      request.address.city,
      request.address.state,
      request.address.zipCode,
      'Brasil',
    ]
      .map((c) => String(c || '').trim())
      .filter(Boolean)
      .join(', ');

    Location.geocodeAsync(addressText)
      .then((results) => {
        const first = Array.isArray(results) && results.length ? results[0] : null;
        if (first && Number.isFinite(first.longitude) && Number.isFinite(first.latitude)) {
          const coords = { latitude: first.latitude, longitude: first.longitude };
          setGeocodedClientCoords(coords);
        }
      })
      .catch(() => {});
  }, [request?.address]);

  const clientCoords = useMemo(() => {
    return toValidCoordinatePair(request?.address?.coordinates) || geocodedClientCoords;
  }, [request?.address?.coordinates, geocodedClientCoords]);

  const professionalCoords = useMemo(() => {
    const live = toValidCoordinatePair(request?.professionalLiveLocation?.coordinates);
    if (live) return live;
    return toValidCoordinatePair(request?.professional?.location?.coordinates);
  }, [request?.professionalLiveLocation?.coordinates, request?.professional?.location?.coordinates]);

  const mapRegion = useMemo(() => {
    if (clientCoords && professionalCoords) {
      const midLat = (clientCoords.latitude + professionalCoords.latitude) / 2;
      const midLng = (clientCoords.longitude + professionalCoords.longitude) / 2;
      const latDelta = Math.max(0.01, Math.abs(clientCoords.latitude - professionalCoords.latitude) * 1.8);
      const lngDelta = Math.max(0.01, Math.abs(clientCoords.longitude - professionalCoords.longitude) * 1.8);
      return {
        latitude: midLat,
        longitude: midLng,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      };
    }
    if (clientCoords) {
      return {
        latitude: clientCoords.latitude,
        longitude: clientCoords.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      };
    }
    return {
      latitude: -23.55052,
      longitude: -46.633308,
      latitudeDelta: 0.2,
      longitudeDelta: 0.2,
    };
  }, [clientCoords, professionalCoords]);

  const etaMinutes = useMemo(() => {
    if (!clientCoords || !professionalCoords) return null;
    const distanceKm = haversineKm(professionalCoords, clientCoords);
    if (!distanceKm || !Number.isFinite(distanceKm)) return null;
    const routeFactor = 1.25;
    const adjustedKm = distanceKm * routeFactor;
    const minutes = Math.ceil((adjustedKm / AVG_SPEED_KMH) * 60);
    return Math.max(1, minutes);
  }, [clientCoords, professionalCoords]);

  const canRenderMap = request?.status === 'on_the_way' && (clientCoords || professionalCoords);

  // Ajusta câmera do mapa quando as coordenadas chegam/atualizam
  const fitMap = useCallback(() => {
    if (!mapRef.current) return;
    const pts = [clientCoords, professionalCoords].filter(Boolean);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      mapRef.current.animateToRegion({
        ...pts[0],
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }, 400);
    } else {
      mapRef.current.fitToCoordinates(pts, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }
  }, [clientCoords, professionalCoords]);

  useEffect(() => {
    if (canRenderMap) {
      const t = setTimeout(fitMap, 600);
      return () => clearTimeout(t);
    }
  }, [canRenderMap, fitMap]);
  const requestDuration = request?.details?.durationMinutes || null;
  const requestStreet = request?.address?.street || 'Endereço não informado';
  const requestCity = request?.address?.city || 'Cidade não informada';
  const estimatedValue = Number.isFinite(toFiniteNumber(request?.pricing?.estimated))
    ? Number(request.pricing.estimated)
    : 0;

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
        {request?.professional && typeof request.professional === 'object' && !!request.professional.name && (
          <View style={styles.proCard}>
            <View style={styles.proAvatarWrap}>
              <LinearGradient colors={colors.gradientSecondary} style={styles.proAvatar}>
                <Text style={styles.proAvatarText}>{String(request.professional.name)[0]}</Text>
              </LinearGradient>
              <View style={styles.proOnline} />
            </View>
            <View style={styles.proInfo}>
              <Text style={styles.proName}>{request.professional.name}</Text>
              <View style={styles.proRating}>
                <Ionicons name="star" size={14} color={colors.warning} />
                <Text style={styles.proRatingText}>
                  {Number.isFinite(toFiniteNumber(request.professional.professional?.rating))
                    ? toFiniteNumber(request.professional.professional?.rating).toFixed(1)
                    : '5.0'} • Diarista
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => {
                lastSeenPeerMsgCount.current = null;
                setUnreadChat(0);
                navigation.navigate('ServiceChat', { requestId, peerName: request.professional.name, role: 'client' });
              }}
            >
              <LinearGradient colors={colors.gradientSecondary} style={styles.callBtnGradient}>
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.white} />
              </LinearGradient>
              {unreadChat > 0 && (
                <View style={styles.chatBadge}>
                  <Text style={styles.chatBadgeText}>{unreadChat > 9 ? '9+' : unreadChat}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {request?.status === 'on_the_way' && (
          <View style={styles.mapCard}>
            <View style={styles.mapHeader}>
              <Text style={styles.cardLabel}>Rastreamento em tempo real</Text>
              <Text style={styles.mapUpdatedText}>
                {formatUpdatedAtLabel(request?.professionalLiveLocationUpdatedAt)}
              </Text>
            </View>

            {canRenderMap ? (
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={mapRegion}
              >
                {clientCoords && (
                  <Marker
                    coordinate={clientCoords}
                    title="Sua casa"
                    description="Endereço do atendimento"
                    anchor={{ x: 0.5, y: 1 }}
                  >
                    <View style={styles.homeMarker}>
                      <Ionicons name="home" size={16} color={colors.white} />
                    </View>
                  </Marker>
                )}

                {professionalCoords && (
                  <Marker
                    coordinate={professionalCoords}
                    title={request?.professional?.name || 'Profissional'}
                    description="Profissional a caminho"
                    pinColor={colors.secondary}
                  />
                )}
              </MapView>
            ) : (
              <View style={styles.mapFallback}>
                <Ionicons name="map-outline" size={22} color={colors.textLight} />
                <Text style={styles.mapFallbackText}>Aguardando coordenadas válidas para abrir o mapa.</Text>
              </View>
            )}

            <View style={styles.etaRow}>
              <View style={styles.etaChip}>
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={styles.etaChipText}>
                  {etaMinutes
                    ? `ETA aproximado: ${etaMinutes} min`
                    : professionalCoords
                      ? 'Calculando ETA...'
                      : 'Aguardando posição do profissional'}
                </Text>
              </View>
              {etaMinutes ? (
                <Text style={styles.etaHint}>Estimativa aproximada com base na distância atual.</Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Detalhes do serviço */}
        {request && (
          <View style={styles.detailsCard}>
            <Text style={styles.cardLabel}>Detalhes</Text>
            {[
              { label: 'Duração', value: requestDuration ? formatDuration(requestDuration) : '-', icon: 'time-outline' },
              { label: 'Endereço', value: `${requestStreet}, ${requestCity}`, icon: 'location-outline' },
              { label: 'Total estimado', value: `R$ ${estimatedValue.toFixed(2)}`, icon: 'cash-outline', highlight: true },
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

        {['accepted', 'preparing', 'on_the_way'].includes(request?.status) && (
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
  callBtn: { borderRadius: 22, overflow: 'visible', position: 'relative' },
  callBtnGradient: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  chatBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: colors.error || '#E53935',
    borderRadius: 10, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, zIndex: 10,
    borderWidth: 1.5, borderColor: colors.white,
  },
  chatBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  mapCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.md,
  },
  mapHeader: { marginBottom: 8 },
  mapUpdatedText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    marginTop: 2,
  },
  map: {
    width: '100%',
    height: 220,
    borderRadius: borderRadius.lg,
  },
  mapFallback: {
    width: '100%',
    height: 160,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  mapFallbackText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  etaRow: {
    marginTop: 10,
    gap: 4,
  },
  etaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  etaChipText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  etaHint: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
  },
  homeMarker: {
    backgroundColor: colors.secondary,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  proMarker: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    minWidth: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    paddingHorizontal: 6,
  },
  proMarkerText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
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

