import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { requestAPI, userAPI } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function ActiveJobScreen({ navigation, route }) {
  const { requestId } = route.params;
  const { emit, on } = useSocket();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clientConfirmed, setClientConfirmed] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadRequest();
    startSendingLocation();

    // Cliente confirmou o profissional → liberar botão de iniciar
    const unsubConfirmed = on('client_confirmed', ({ requestId: rId }) => {
      if (rId?.toString() === requestId?.toString()) {
        setClientConfirmed(true);
      }
    });

    // Cliente rejeitou este profissional → volta para Dashboard
    const unsubRejected = on('client_rejected_professional', ({ requestId: rId }) => {
      if (rId?.toString() === requestId?.toString()) {
        Alert.alert(
          'Cliente buscou outro profissional',
          'O cliente optou por buscar um outro profissional para esta solicitação.',
          [{ text: 'OK', onPress: () => navigation.replace('Dashboard') }]
        );
      }
    });

    return () => {
      unsubConfirmed && unsubConfirmed();
      unsubRejected && unsubRejected();
    };
  }, []);

  const loadRequest = async () => {
    try {
      const { data } = await requestAPI.getById(requestId);
      setRequest(data.request);
      setClientConfirmed(Boolean(data.request.clientConfirmedAt) || ['in_progress', 'completed'].includes(data.request.status));
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar o serviço.');
    } finally {
      setLoading(false);
    }
  };

  const startSendingLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    // Envia localização a cada 15 segundos
    const interval = setInterval(async () => {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      emit('update_location', {
        longitude: loc.coords.longitude,
        latitude: loc.coords.latitude,
      });
      userAPI.updateLocation(loc.coords.longitude, loc.coords.latitude).catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await requestAPI.start(requestId);
      loadRequest();
    } catch {
      Alert.alert('Erro', 'Não foi possível iniciar o serviço.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = () => {
    Alert.alert(
      'Concluir serviço',
      'Confirma que o serviço foi concluído?',
      [
        { text: 'Cancelar' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setActionLoading(true);
            try {
              await requestAPI.complete(requestId);
              navigation.replace('Dashboard');
            } catch {
              Alert.alert('Erro', 'Não foi possível concluir o serviço.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

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
        colors={
          request?.status === 'in_progress'
            ? [colors.warning, '#E65100']
            : clientConfirmed || request?.status !== 'accepted'
            ? colors.gradientSecondary
            : ['#5C6BC0', '#3949AB']  // roxo para estado de espera
        }
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerIconWrap}>
            <Ionicons
              name={
                request?.status === 'in_progress'
                  ? 'home'
                  : clientConfirmed
                  ? 'walk'
                  : 'time'
              }
              size={30}
              color={colors.white}
            />
          </View>
          <Text style={styles.headerTitle}>
            {request?.status === 'in_progress'
              ? 'Serviço em andamento'
              : clientConfirmed
              ? 'A caminho do cliente'
              : 'Aguardando confirmação'}
          </Text>
          {(clientConfirmed || request?.status === 'in_progress') && (
            <View style={styles.locBadge}>
              <Ionicons name="location" size={12} color={colors.white} />
              <Text style={styles.locBadgeText}>Localização sendo enviada</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Cliente */}
        {request?.client && (
          <View style={styles.clientCard}>
            <LinearGradient colors={colors.gradientPrimary} style={styles.clientAvatar}>
              <Text style={styles.clientAvatarText}>{request.client.name[0]}</Text>
            </LinearGradient>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{request.client.name}</Text>
              <Text style={styles.clientPhone}>{clientConfirmed ? 'Chat liberado para este serviço' : 'Aguardando confirmação do cliente'}</Text>
            </View>
            {clientConfirmed && (
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => navigation.navigate('ServiceChat', { requestId, peerName: request.client.name, role: 'professional' })}
              >
                <LinearGradient colors={colors.gradientSecondary} style={styles.callBtnGrad}>
                  <Ionicons name="chatbubble-ellipses" size={18} color={colors.white} />
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Detalhes */}
        {request && (
          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>Detalhes do serviço</Text>
            {[
              { icon: 'location-outline', label: 'Endereço', value: `${request.address.street}${request.address.complement ? `, ${request.address.complement}` : ''} — ${request.address.city}` },
              { icon: 'time-outline', label: 'Duração', value: `${request.details.hours} horas` },
              ...((request.details.customFormSummary || []).length
                ? (request.details.customFormSummary || []).map((item) => ({
                  icon: 'list-outline',
                  label: item.label,
                  value: item.displayValue || String(item.value || '-'),
                }))
                : [{ icon: 'grid-outline', label: 'Cômodos', value: `${request.details.rooms} cômodo(s), ${request.details.bathrooms} banheiro(s)` }]),
              ...(request.serviceTypeSlug === 'diarista'
                ? [{ icon: 'cube-outline', label: 'Produtos', value: request.details.hasProducts ? 'Cliente fornece' : 'Você traz' }]
                : []),
              ...(request.details.notes ? [{ icon: 'chatbubble-outline', label: 'Obs.', value: request.details.notes }] : []),
            ].map((row, i) => (
              <View key={i} style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name={row.icon} size={16} color={colors.secondary} />
                </View>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue}>{row.value}</Text>
              </View>
            ))}
            <View style={styles.earningsRow}>
              <Text style={styles.earningsLabel}>Seu ganho</Text>
              <Text style={styles.earningsValue}>
                R$ {(request.pricing.estimated * 0.85).toFixed(2)}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Botão de ação */}
      <View style={styles.footer}>
        {request?.status === 'accepted' && !clientConfirmed && (
          <View style={styles.waitingBanner}>
            <Ionicons name="hourglass-outline" size={20} color="#5C6BC0" />
            <Text style={styles.waitingText}>Aguardando confirmação do cliente...</Text>
          </View>
        )}
        {request?.status === 'accepted' && clientConfirmed && (
          <TouchableOpacity
            style={styles.btnWrap}
            onPress={handleStart}
            disabled={actionLoading}
          >
            <LinearGradient colors={colors.gradientSecondary} style={styles.btn}>
              {actionLoading
                ? <ActivityIndicator color={colors.white} />
                : (
                  <>
                    <Ionicons name="play" size={20} color={colors.white} />
                    <Text style={styles.btnText}>Iniciar serviço</Text>
                  </>
                )}
            </LinearGradient>
          </TouchableOpacity>
        )}
        {request?.status === 'in_progress' && (
          <TouchableOpacity
            style={styles.btnWrap}
            onPress={handleComplete}
            disabled={actionLoading}
          >
            <LinearGradient colors={[colors.success, '#00A044']} style={styles.btn}>
              {actionLoading
                ? <ActivityIndicator color={colors.white} />
                : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={colors.white} />
                    <Text style={styles.btnText}>Concluir serviço</Text>
                  </>
                )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
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
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
  },
  locBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
  },
  locBadgeText: { fontSize: 11, color: colors.white, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 24 },
  clientCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.md,
  },
  clientAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientAvatarText: { color: colors.white, fontSize: typography.fontSizes.xl, fontWeight: '700' },
  clientInfo: { flex: 1 },
  clientName: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  clientPhone: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 2 },
  callBtn: { borderRadius: 22, overflow: 'hidden' },
  callBtnGrad: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  detailsTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 12,
  },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: `${colors.secondary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, minWidth: 60 },
  detailValue: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '500' },
  earningsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  earningsLabel: { fontSize: typography.fontSizes.md, color: colors.textSecondary, fontWeight: '500' },
  earningsValue: { fontSize: typography.fontSizes.xxl, fontWeight: '800', color: colors.success },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  btnWrap: { borderRadius: borderRadius.full, overflow: 'hidden' },
  btn: {
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  btnText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.lg },
  waitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#EDE7F6',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#C5CAE9',
  },
  waitingText: {
    color: '#3949AB',
    fontWeight: '600',
    fontSize: 14,
  },
});
