import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Vibration, Animated, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../theme';

const { width, height } = Dimensions.get('window');

// Padrão de vibração: toca 600ms, pausa 400ms, toca 600ms (repete)
const VIBRATION_PATTERN = [0, 600, 400, 600, 400, 600];

const fmt = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export default function IncomingJobModal({ visible, request, onAccept, onReject, loading }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      Vibration.cancel();
      return;
    }

    // Vibração repetitiva
    Vibration.vibrate(VIBRATION_PATTERN, true);

    // Animação de pulso no ícone
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );

    // Ondas de ripple
    const rippleLoop = Animated.loop(
      Animated.stagger(400, [
        Animated.sequence([
          Animated.timing(ripple1, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(ripple1, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(ripple2, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(ripple2, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );

    pulseAnim.start();
    rippleLoop.start();

    return () => {
      pulseAnim.stop();
      rippleLoop.stop();
      Vibration.cancel();
    };
  }, [visible]);

  const handleAccept = () => {
    Vibration.cancel();
    onAccept(request?.requestId);
  };

  const handleReject = () => {
    Vibration.cancel();
    onReject(request?.requestId);
  };

  const scheduledDate = request?.details?.scheduledDate
    ? new Date(request.details.scheduledDate)
    : null;

  const ripple1Scale = ripple1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ripple1Opacity = ripple1.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 0.3, 0] });
  const ripple2Scale = ripple2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ripple2Opacity = ripple2.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 0.3, 0] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <LinearGradient
          colors={['#1A1A2E', '#16213E', '#0F3460']}
          style={styles.container}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* Label no topo */}
          <View style={styles.topBadge}>
            <View style={styles.topBadgeDot} />
            <Text style={styles.topBadgeText}>Novo pedido de serviço</Text>
          </View>

          {/* Animação de ícone com ripple */}
          <View style={styles.iconContainer}>
            <Animated.View
              style={[styles.ripple, {
                transform: [{ scale: ripple1Scale }],
                opacity: ripple1Opacity,
              }]}
            />
            <Animated.View
              style={[styles.ripple, {
                transform: [{ scale: ripple2Scale }],
                opacity: ripple2Opacity,
              }]}
            />
            <Animated.View style={[styles.iconCircle, { transform: [{ scale: pulse }] }]}>
              <LinearGradient colors={['#FF8C38', '#FF6B00']} style={styles.iconGradient}>
                <Ionicons name="briefcase" size={38} color="#fff" />
              </LinearGradient>
            </Animated.View>
          </View>

          {/* Info do cliente */}
          <Text style={styles.clientName}>{request?.client?.name || 'Cliente'}</Text>
          <Text style={styles.serviceType}>Solicitou um serviço de limpeza</Text>

          {/* Detalhes do serviço */}
          <View style={styles.detailsCard}>
            {scheduledDate && (
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <Text style={styles.detailText}>
                  {dayNames[scheduledDate.getDay()]},{' '}
                  {scheduledDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} às{' '}
                  {scheduledDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}
            {request?.details?.hours && (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={styles.detailText}>{request.details.hours}h de serviço</Text>
              </View>
            )}
            {request?.address?.city && (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={16} color={colors.primary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {request.address.neighborhood ? `${request.address.neighborhood}, ` : ''}
                  {request.address.city}
                </Text>
              </View>
            )}
            <View style={styles.detailDivider} />
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Você receberá</Text>
              <Text style={styles.priceValue}>
                {fmt((request?.pricing?.estimated || 0) * 0.85)}
              </Text>
            </View>
          </View>

          {/* Botões aceitar / recusar */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={handleReject}
              activeOpacity={0.85}
              disabled={loading}
            >
              <Ionicons name="close" size={28} color="#F44336" />
              <Text style={styles.rejectText}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.acceptBtn}
              onPress={handleAccept}
              activeOpacity={0.85}
              disabled={loading}
            >
              <LinearGradient colors={['#43A047', '#00C853']} style={styles.acceptGradient}>
                <Ionicons name="checkmark" size={28} color="#fff" />
                <Text style={styles.acceptText}>Aceitar</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: {
    width: '100%',
    borderRadius: 28,
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: spacing.lg,
  },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,107,0,0.2)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
    marginBottom: 32,
  },
  topBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  topBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  iconContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ripple: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.primary,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    overflow: 'hidden',
  },
  iconGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  serviceType: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
    marginBottom: 24,
  },
  detailsCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: spacing.md,
    gap: 12,
    marginBottom: 32,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, flex: 1 },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  priceValue: { color: '#4CAF50', fontSize: 22, fontWeight: '800' },
  actions: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  rejectBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(244,67,54,0.12)',
    borderRadius: 20,
    paddingVertical: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(244,67,54,0.3)',
  },
  rejectText: { color: '#F44336', fontSize: 13, fontWeight: '700' },
  acceptBtn: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  acceptGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 18,
  },
  acceptText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
