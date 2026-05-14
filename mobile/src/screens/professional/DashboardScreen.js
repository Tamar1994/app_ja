import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
  Alert, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { requestAPI, userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatDuration } from '../../utils/format';
import IncomingJobModal from '../../components/IncomingJobModal';
import { registerForPushNotifications } from '../../services/notifications';
import { getPendingNotification, clearPendingNotification } from '../../services/pendingNotification';

export default function DashboardScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const { emit, on } = useSocket();
  const [available, setAvailable] = useState(user?.professional?.isAvailable || false);
  const [requests, setRequests] = useState([]);
  const [scheduledRequests, setScheduledRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedScheduledRequest, setSelectedScheduledRequest] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [incomingJob, setIncomingJob] = useState(null);
  const [activeTab, setActiveTab] = useState('immediate'); // 'immediate' | 'scheduled'

  const loadRequests = useCallback(async () => {
    try {
      const [immedRes, schedRes] = await Promise.all([
        requestAPI.list('available').catch(() => ({ data: { requests: [] } })),
        requestAPI.scheduledFeed().catch(() => ({ data: { requests: [] } })),
      ]);
      setRequests(immedRes.data.requests);
      setScheduledRequests(schedRes.data.requests);
    } catch {
      // ignora
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();

    // Registrar token de push notification (1x ao montar)
    registerForPushNotifications()
      .then(token => {
        if (token) userAPI.savePushToken(token).catch(() => {});
      })
      .catch(() => {});

    // Solicitar permissão de localização — necessária para receber pedidos próximos
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Localização necessária',
          'O Já! precisa da sua localização para enviar pedidos próximos a você. Ative a permissão de localização nas configurações do dispositivo.',
          [{ text: 'Entendido' }]
        );
      } else {
        // Enviar localização atual ao servidor imediatamente
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          userAPI.updateLocation(loc.coords.longitude, loc.coords.latitude).catch(() => {});
        } catch { /* não-crítico */ }
      }
    })();

    // Quando chega novo pedido: mostrar modal tipo ligação
    const unsub = on('new_request', (data) => {
      setIncomingJob(data);
      loadRequests();
    });
    // Quando o timer de 5 min expira no servidor: fechar modal automaticamente
    const unsubExpired = on('request_expired', ({ requestId }) => {
      setIncomingJob(prev => {
        if (prev?.requestId?.toString() === requestId?.toString()) {
          return null; // fecha o modal
        }
        return prev;
      });
      loadRequests();
    });
    const unsubTaken = on('request_taken', ({ requestId }) => {
      setIncomingJob(prev => {
        if (prev?.requestId?.toString() === requestId?.toString()) {
          return null;
        }
        return prev;
      });
      setSelectedRequest(prev => {
        if (prev?._id?.toString() === requestId?.toString()) return null;
        return prev;
      });
      clearPendingNotification();
      loadRequests();
    });

    // Quando cliente confirma agendamento: remover do modal se estiver aberto
    const unsubSchedConfirmed = on('schedule_client_confirmed', ({ requestId }) => {
      setSelectedScheduledRequest(prev => {
        if (prev?._id?.toString() === requestId?.toString()) return null;
        return prev;
      });
      // Recarregar para atualizar contadores
      loadRequests();
    });

    // Quando cliente recusa: remover da lista (back to pending_professional = outro pro pegar)
    const unsubSchedRejected = on('schedule_client_rejected', ({ requestId }) => {
      setSelectedScheduledRequest(prev => {
        if (prev?._id?.toString() === requestId?.toString()) return null;
        return prev;
      });
      setScheduledRequests(prev => prev.filter(r => r._id?.toString() !== requestId?.toString()));
      Alert.alert('Agendamento', 'O cliente optou por outro profissional para este agendamento.');
    });

    return () => {
      unsub && unsub();
      unsubExpired && unsubExpired();
      unsubTaken && unsubTaken();
      unsubSchedConfirmed && unsubSchedConfirmed();
      unsubSchedRejected && unsubSchedRejected();
    };
  }, []);

  // Verificar notificação pendente (app foi aberto pelo tap na notificação)
  useFocusEffect(
    useCallback(() => {
      const pending = getPendingNotification();
      if (pending) {
        clearPendingNotification();
        if (pending.type === 'chat_message' && pending.requestId) {
          // Abrir chat da mensagem recebida
          setTimeout(() => navigation.navigate('ServiceChat', { requestId: pending.requestId, role: 'professional' }), 300);
        } else {
          setTimeout(() => setIncomingJob(pending), 300);
        }
      }
      loadRequests();
      return () => {
        setIncomingJob(null);
        setSelectedRequest(null);
      };
    }, [loadRequests])
  );

  const handleIncomingAccept = async (requestId) => {
    if (!requestId) return;
    setActionLoading(true);
    try {
      await requestAPI.accept(requestId);
      clearPendingNotification();
      setIncomingJob(null);
      setSelectedRequest(null);
      navigation.navigate('ActiveJob', { requestId });
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível aceitar.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIncomingReject = async (requestId) => {
    if (!requestId) { setIncomingJob(null); return; }
    try {
      await requestAPI.reject(requestId);
    } catch { /* ignora */ } finally {
      setIncomingJob(null);
      loadRequests();
    }
  };

  const toggleAvailability = async (val) => {
    setAvailable(val);
    try {
      await userAPI.setAvailability(val);
      emit('toggle_availability', { isAvailable: val });
      updateUser({ professional: { ...user.professional, isAvailable: val } });
    } catch {
      setAvailable(!val);
    }
  };

  const handleAccept = async (requestId) => {
    setActionLoading(true);
    try {
      await requestAPI.accept(requestId);
      clearPendingNotification();
      setIncomingJob(null);
      setSelectedRequest(null);
      navigation.navigate('ActiveJob', { requestId });
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível aceitar.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (requestId) => {
    try {
      clearPendingNotification();
      await requestAPI.reject(requestId);
      setIncomingJob(null);
      setSelectedRequest(null);
      setRequests((prev) => prev.filter((r) => r._id !== requestId));
    } catch {
      Alert.alert('Erro', 'Não foi possível recusar.');
    }
  };

  const handleScheduleAccept = async (requestId) => {
    setActionLoading(true);
    try {
      await requestAPI.scheduleAccept(requestId);
      setSelectedScheduledRequest(null);
      setScheduledRequests(prev => prev.filter(r => r._id !== requestId));
      Alert.alert(
        '📅 Agendamento aceito!',
        'O cliente será notificado. Aguarde a confirmação dele. O serviço aparecerá na sua Agenda após a confirmação.',
        [{ text: 'OK' }],
      );
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível aceitar o agendamento.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleScheduleReject = async (requestId) => {
    try {
      await requestAPI.scheduleReject(requestId);
      setSelectedScheduledRequest(null);
      setScheduledRequests(prev => prev.filter(r => r._id !== requestId));
    } catch {
      Alert.alert('Erro', 'Não foi possível recusar.');
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelectedRequest(item)} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <LinearGradient colors={colors.gradientSecondary} style={styles.cardAvatar}>
          <Text style={styles.cardAvatarText}>{item.client?.name?.[0] || '?'}</Text>
        </LinearGradient>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.client?.name || 'Cliente'}</Text>
          <View style={styles.cardAddressRow}>
            <Ionicons name="location-outline" size={12} color={colors.textLight} />
            <Text style={styles.cardAddress} numberOfLines={1}>
              {item.address.street}, {item.address.city}
            </Text>
          </View>
        </View>
        <View style={styles.priceWrap}>
          <Text style={styles.cardPriceLabel}>ganho</Text>
          <Text style={styles.cardPrice}>R$ {((item.pricing.estimated || 0) * (1 - (item.pricing.platformFeePercent || 15) / 100)).toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.cardDivider} />
      <View style={styles.cardTags}>
        {[
          { icon: 'time-outline', label: formatDuration(item.details.durationMinutes) },
          ...(item.details.tierLabel ? [{ icon: 'pricetag-outline', label: item.details.tierLabel }] : []),
          ...((item.details.upsells || []).length ? [{ icon: 'add-circle-outline', label: `+${item.details.upsells.length} extra(s)` }] : []),
          { icon: 'calendar-outline', label: new Date(item.details.scheduledDate).toLocaleDateString('pt-BR') },
        ].map((tag, i) => (
          <View key={i} style={styles.tag}>
            <Ionicons name={tag.icon} size={12} color={colors.secondary} />
            <Text style={styles.tagText}>{tag.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.tapHint}>
        <Text style={styles.tapHintText}>Toque para ver detalhes →</Text>
      </View>
    </TouchableOpacity>
  );

  const renderScheduledItem = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelectedScheduledRequest(item)} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <LinearGradient colors={['#EEF2FF', '#E8F0FE']} style={styles.cardAvatar}>
          <Ionicons name="calendar" size={22} color={colors.primary} />
        </LinearGradient>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.client?.name || 'Cliente'}</Text>
          <Text style={styles.cardAddress} numberOfLines={1}>
            {item.address?.street}, {item.address?.city}
          </Text>
        </View>
        <View style={styles.priceWrap}>
          <Text style={styles.cardPriceLabel}>estimado</Text>
          <Text style={styles.cardPrice}>
            R$ {((item.pricing?.estimated || 0) * (1 - (item.pricing?.platformFeePercent || 15) / 100)).toFixed(0)}
          </Text>
        </View>
      </View>
      <View style={styles.cardDivider} />
      <View style={styles.cardTags}>
        {[
          { icon: 'pricetag-outline', label: item.details?.tierLabel || '-' },
          { icon: 'calendar-outline', label: new Date(item.details?.scheduledDate).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) },
          { icon: 'time-outline', label: new Date(item.details?.scheduledDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
        ].map((tag, i) => (
          <View key={i} style={[styles.tag, { backgroundColor: `${colors.primary}10` }]}>
            <Ionicons name={tag.icon} size={12} color={colors.primary} />
            <Text style={[styles.tagText, { color: colors.primary }]}>{tag.label}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.tapHint, { backgroundColor: `${colors.primary}10` }]}>
        <Text style={[styles.tapHintText, { color: colors.primary }]}>Toque para ver detalhes e aceitar →</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header premium com gradiente condicional */}
      <LinearGradient
        colors={available ? colors.gradientSecondary : colors.gradientDark}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Olá, {user.name.split(' ')[0]}!</Text>
            <Text style={styles.headerSub}>
              {available ? 'Você está disponível para pedidos' : 'Você está offline'}
            </Text>
          </View>
          {/* Toggle online/offline */}
          <TouchableOpacity
            style={[styles.toggleBtn, available && styles.toggleBtnActive]}
            onPress={() => toggleAvailability(!available)}
            activeOpacity={0.8}
          >
            <View style={[styles.toggleDot, available && styles.toggleDotActive]} />
            <Text style={[styles.toggleLabel, available && styles.toggleLabelActive]}>
              {available ? 'Online' : 'Offline'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {[
            { icon: 'star', value: user.professional?.rating?.toFixed(1) || '—', label: 'Avaliação', color: colors.warning },
            { icon: 'checkmark-circle', value: user.professional?.totalServicesCompleted || 0, label: 'Serviços', color: colors.success },
          ].map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Ionicons name={s.icon} size={20} color={s.color} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* Tabs: Imediatos / Agendamentos */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'immediate' && styles.tabActive]}
          onPress={() => setActiveTab('immediate')}
        >
          <Ionicons name="flash" size={15} color={activeTab === 'immediate' ? colors.primary : colors.textLight} />
          <Text style={[styles.tabText, activeTab === 'immediate' && styles.tabTextActive]}>
            Imediatos {requests.length > 0 ? `(${requests.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'scheduled' && styles.tabActive]}
          onPress={() => setActiveTab('scheduled')}
        >
          <Ionicons name="calendar" size={15} color={activeTab === 'scheduled' ? colors.primary : colors.textLight} />
          <Text style={[styles.tabText, activeTab === 'scheduled' && styles.tabTextActive]}>
            Agendamentos {scheduledRequests.length > 0 ? `(${scheduledRequests.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => { setRefreshing(true); loadRequests(); }}
        >
          <Ionicons name="refresh" size={18} color={colors.secondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.secondary} style={{ marginTop: 32 }} />
      ) : activeTab === 'immediate' ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadRequests(); }}
              colors={[colors.secondary]}
            />
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="flash-outline" size={36} color={colors.textLight} />
              </View>
              <Text style={styles.emptyTitle}>
                {available ? 'Nenhum pedido imediato no momento' : 'Fique online para receber pedidos'}
              </Text>
              {!available && (
                <TouchableOpacity
                  style={styles.goOnlineBtn}
                  onPress={() => toggleAvailability(true)}
                >
                  <LinearGradient colors={colors.gradientSecondary} style={styles.goOnlineGradient}>
                    <Text style={styles.goOnlineText}>Ficar online agora</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      ) : (
        <FlatList
          data={scheduledRequests}
          keyExtractor={(item) => item._id}
          renderItem={renderScheduledItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadRequests(); }}
              colors={[colors.secondary]}
            />
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="calendar-outline" size={36} color={colors.textLight} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum agendamento disponível no momento</Text>
              <Text style={styles.emptySubtitle}>Puxe para atualizar e ver novos pedidos de agendamento</Text>
            </View>
          }
        />
      )}

      {/* Modal de aceitar/recusar */}
      <Modal visible={!!selectedRequest} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Novo pedido!</Text>

            {selectedRequest && (
              <>
                <View style={styles.modalDetail}>
                  {[
                    { icon: 'person-outline', label: 'Cliente', value: selectedRequest.client?.name },
                    { icon: 'time-outline', label: 'Duração', value: formatDuration(selectedRequest.details.durationMinutes) },
                    ...(selectedRequest.details.tierLabel ? [{ icon: 'pricetag-outline', label: 'Faixa', value: selectedRequest.details.tierLabel }] : []),
                    ...((selectedRequest.details.upsells || []).length
                      ? (selectedRequest.details.upsells || []).map((item) => ({
                        icon: 'add-circle-outline',
                        label: item.label || item.key,
                        value: `R$ ${Number(item.price || 0).toFixed(2)}`,
                      }))
                      : []),
                    { icon: 'location-outline', label: 'Endereço', value: `${selectedRequest.address.street}, ${selectedRequest.address.city}` },
                    { icon: 'calendar-outline', label: 'Data', value: new Date(selectedRequest.details.scheduledDate).toLocaleDateString('pt-BR') },
                  ].map((row, i) => (
                    <View key={i} style={styles.detailRow}>
                      <View style={styles.detailIcon}>
                        <Ionicons name={row.icon} size={16} color={colors.secondary} />
                      </View>
                      <Text style={styles.detailLabel}>{row.label}</Text>
                      <Text style={styles.detailValue} numberOfLines={2}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                <LinearGradient
                  colors={[colors.success + '20', colors.success + '08']}
                  style={styles.priceCard}
                >
                  <Text style={styles.priceCardLabel}>Você receberá</Text>
                  <Text style={styles.priceCardValue}>
                    R$ {(selectedRequest.pricing.estimated * 0.85).toFixed(2)}
                  </Text>
                  <Text style={styles.priceCardDetail}>após taxa da plataforma (15%)</Text>
                </LinearGradient>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.btnReject}
                    onPress={() => handleReject(selectedRequest._id)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.btnRejectText}>Recusar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnAcceptWrap}
                    onPress={() => handleAccept(selectedRequest._id)}
                    disabled={actionLoading}
                  >
                    <LinearGradient colors={[colors.success, '#00A044']} style={styles.btnAccept}>
                      {actionLoading
                        ? <ActivityIndicator color={colors.white} />
                        : <Text style={styles.btnAcceptText}>Aceitar</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity onPress={() => setSelectedRequest(null)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de detalhes de agendamento */}
      <Modal visible={!!selectedScheduledRequest} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Pedido de agendamento</Text>
            {selectedScheduledRequest && (
              <>
                <View style={styles.modalDetail}>
                  {[
                    { icon: 'person-outline', label: 'Cliente', value: selectedScheduledRequest.client?.name },
                    {
                      icon: 'calendar-outline', label: 'Data',
                      value: new Date(selectedScheduledRequest.details?.scheduledDate).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }),
                    },
                    {
                      icon: 'time-outline', label: 'Horário',
                      value: new Date(selectedScheduledRequest.details?.scheduledDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    },
                    { icon: 'pricetag-outline', label: 'Serviço', value: selectedScheduledRequest.details?.tierLabel },
                    {
                      icon: 'location-outline', label: 'Endereço',
                      value: `${selectedScheduledRequest.address?.street}, ${selectedScheduledRequest.address?.city}`,
                    },
                  ].map((row, i) => (
                    <View key={i} style={styles.detailRow}>
                      <View style={styles.detailIcon}><Ionicons name={row.icon} size={16} color={colors.primary} /></View>
                      <Text style={styles.detailLabel}>{row.label}</Text>
                      <Text style={styles.detailValue} numberOfLines={2}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.earningsHighlight, { backgroundColor: colors.success + '15' }]}>
                  <Text style={[styles.earningsLabel, { color: colors.success }]}>Estimativa de ganho</Text>
                  <Text style={[styles.earningsValue, { color: colors.success }]}>
                    R$ {((selectedScheduledRequest.pricing?.estimated || 0) * (1 - (selectedScheduledRequest.pricing?.platformFeePercent || 15) / 100)).toFixed(2)}
                  </Text>
                  <Text style={[styles.earningsNote, { color: colors.textLight, fontSize: 11 }]}>
                    Pagamento após conclusão · buffer de 30min para deslocamento
                  </Text>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.btnReject}
                    onPress={() => handleScheduleReject(selectedScheduledRequest._id)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.btnRejectText}>Recusar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnAcceptWrap}
                    onPress={() => handleScheduleAccept(selectedScheduledRequest._id)}
                    disabled={actionLoading}
                  >
                    <LinearGradient colors={[colors.primary, colors.primaryDark || '#C0392B']} style={styles.btnAccept}>
                      {actionLoading
                        ? <ActivityIndicator color={colors.white} />
                        : <Text style={styles.btnAcceptText}>Aceitar agendamento</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <TouchableOpacity onPress={() => setSelectedScheduledRequest(null)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal tipo ligação — pedido via socket em tempo real */}
      <IncomingJobModal
        visible={!!incomingJob}
        request={incomingJob}
        onAccept={handleIncomingAccept}
        onReject={handleIncomingReject}
        loading={actionLoading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Header
  header: {
    paddingTop: 55,
    paddingBottom: 24,
    paddingHorizontal: spacing.lg,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.white },
  headerSub: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(0,200,83,0.2)',
    borderColor: colors.success,
  },
  toggleDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textLight,
  },
  toggleDotActive: { backgroundColor: colors.success },
  toggleLabel: { color: 'rgba(255,255,255,0.7)', fontWeight: '600', fontSize: typography.fontSizes.sm },
  toggleLabelActive: { color: colors.success },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: borderRadius.lg,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statValue: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.white },
  statLabel: { fontSize: typography.fontSizes.xs, color: 'rgba(255,255,255,0.65)' },
  // List header
  listHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  listTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${colors.secondary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: 90 },
  // Cards
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    ...shadows.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAvatarText: { color: colors.white, fontSize: typography.fontSizes.lg, fontWeight: '700' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  cardAddressRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  cardAddress: { fontSize: typography.fontSizes.xs, color: colors.textLight, flex: 1 },
  priceWrap: { alignItems: 'flex-end' },
  cardPriceLabel: { fontSize: 10, color: colors.textLight, fontWeight: '500' },
  cardPrice: { fontSize: typography.fontSizes.lg, fontWeight: '800', color: colors.success },
  cardDivider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.md },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: spacing.md },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.secondary}10`,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { fontSize: 12, color: colors.secondary, fontWeight: '600' },
  tapHint: { backgroundColor: `${colors.secondary}10`, paddingVertical: 7, alignItems: 'center' },
  tapHintText: { fontSize: 11, color: colors.secondary, fontWeight: '600' },
  // Tabs
  tabsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    backgroundColor: colors.white, gap: spacing.sm,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: borderRadius.full,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  tabActive: { backgroundColor: `${colors.primary}10`, borderColor: colors.primary },
  tabText: { fontSize: typography.fontSizes.sm, fontWeight: '600', color: colors.textLight },
  tabTextActive: { color: colors.primary },
  emptySubtitle: {
    fontSize: typography.fontSizes.sm, color: colors.textLight,
    textAlign: 'center', marginTop: 8, paddingHorizontal: spacing.xl,
  },
  // Earnings highlight (used in scheduled request modal)
  earningsHighlight: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: colors.success + '30',
  },
  earningsLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    marginBottom: 4,
  },
  earningsValue: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 42,
  },
  earningsNote: {
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  // Empty
  empty: { alignItems: 'center', paddingTop: 64, gap: spacing.md },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  emptyTitle: { fontSize: typography.fontSizes.md, color: colors.textSecondary, textAlign: 'center', maxWidth: 220 },
  goOnlineBtn: { borderRadius: borderRadius.full, overflow: 'hidden', marginTop: 4 },
  goOnlineGradient: { paddingHorizontal: 32, paddingVertical: 14 },
  goOnlineText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.md },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: 36,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.lg,
  },
  modalTitle: { fontSize: typography.fontSizes.xxl, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  modalDetail: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 8,
  },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  detailIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: `${colors.secondary}15`, alignItems: 'center', justifyContent: 'center',
  },
  detailLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, width: 70 },
  detailValue: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '600' },
  priceCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.success + '30',
  },
  priceCardLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  priceCardValue: { fontSize: 38, fontWeight: '800', color: colors.success, lineHeight: 48 },
  priceCardDetail: { fontSize: typography.fontSizes.xs, color: colors.textLight },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  btnReject: {
    flex: 1, borderWidth: 1.5, borderColor: colors.error + '50',
    borderRadius: borderRadius.full, paddingVertical: 15, alignItems: 'center',
    backgroundColor: colors.error + '08',
  },
  btnRejectText: { color: colors.error, fontWeight: '700', fontSize: typography.fontSizes.md },
  btnAcceptWrap: { flex: 2, borderRadius: borderRadius.full, overflow: 'hidden' },
  btnAccept: { paddingVertical: 15, alignItems: 'center' },
  btnAcceptText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.md },
  modalClose: { alignItems: 'center', paddingVertical: spacing.sm },
  modalCloseText: { color: colors.textLight, fontSize: typography.fontSizes.md },
});

