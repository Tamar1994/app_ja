import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, Animated, Alert, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSocket } from '../../context/SocketContext';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const { width } = Dimensions.get('window');

export default function SearchingScreen({ navigation, route }) {
  const { requestId } = route.params;
  const { on } = useSocket();
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const createPulse = (val, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1.5, duration: 1200, useNativeDriver: true }),
          Animated.timing(val, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.delay(600),
        ])
      );

    const a1 = createPulse(pulse1, 0);
    const a2 = createPulse(pulse2, 400);
    const a3 = createPulse(pulse3, 800);
    a1.start(); a2.start(); a3.start();

    const unsub = on('request_accepted', ({ request }) => {
      if (request._id === requestId || request._id?.toString() === requestId) {
        a1.stop(); a2.stop(); a3.stop();
        navigation.replace('Tracking', { requestId });
      }
    });

    // Polling fallback a cada 15s (caso socket caia)
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await requestAPI.getById(requestId);
        if (data.request?.status === 'accepted' || data.request?.status === 'in_progress') {
          a1.stop(); a2.stop(); a3.stop();
          clearInterval(pollInterval);
          navigation.replace('Tracking', { requestId });
        } else if (data.request?.status === 'cancelled') {
          clearInterval(pollInterval);
          navigation.replace('Home');
        }
      } catch {}
    }, 15000);

    return () => {
      a1.stop(); a2.stop(); a3.stop();
      unsub && unsub();
      clearInterval(pollInterval);
    };
  }, [requestId]);

  const handleCancel = () => {
    Alert.alert(
      'Cancelar solicitação',
      'Deseja cancelar a busca por profissional?',
      [
        { text: 'Não' },
        {
          text: 'Sim, cancelar',
          style: 'destructive',
          onPress: async () => {
            try {
              await requestAPI.cancel(requestId, 'Cancelado pelo cliente');
              navigation.replace('Home');
            } catch {
              Alert.alert('Erro', 'Não foi possível cancelar.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={['#1A1A2E', '#16213E', '#E05A00']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {/* Animação de ondas */}
          <View style={styles.pulseContainer}>
            <Animated.View style={[styles.pulseRing, styles.ring3, { transform: [{ scale: pulse3 }] }]} />
            <Animated.View style={[styles.pulseRing, styles.ring2, { transform: [{ scale: pulse2 }] }]} />
            <Animated.View style={[styles.pulseRing, styles.ring1, { transform: [{ scale: pulse1 }] }]} />
            <LinearGradient
              colors={colors.gradientPrimary}
              style={styles.centerCircle}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="search" size={40} color={colors.white} />
            </LinearGradient>
          </View>

          <Text style={styles.title}>Buscando profissional</Text>
          <Text style={styles.subtitle}>
            Estamos encontrando a melhor diarista disponível perto de você.
          </Text>

          {/* Steps de progresso */}
          <View style={styles.stepsCard}>
            {[
              { icon: 'locate-outline', text: 'Verificando sua região', done: true },
              { icon: 'star-outline', text: 'Priorizando melhor avaliadas', done: true },
              { icon: 'notifications-outline', text: 'Aguardando confirmação...', done: false },
            ].map((step, i) => (
              <View key={i} style={styles.step}>
                <View style={[styles.stepDot, step.done && styles.stepDotDone]}>
                  <Ionicons
                    name={step.done ? 'checkmark' : step.icon}
                    size={14}
                    color={step.done ? colors.white : 'rgba(255,255,255,0.5)'}
                  />
                </View>
                <Text style={[styles.stepText, step.done && styles.stepTextDone]}>{step.text}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancelar busca</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  pulseContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  pulseRing: {
    position: 'absolute',
    borderRadius: 999,
  },
  ring1: {
    width: 130,
    height: 130,
    backgroundColor: 'rgba(255,107,0,0.15)',
  },
  ring2: {
    width: 160,
    height: 160,
    backgroundColor: 'rgba(255,107,0,0.08)',
  },
  ring3: {
    width: 200,
    height: 200,
    backgroundColor: 'rgba(255,107,0,0.04)',
  },
  centerCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primary,
  },
  title: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: colors.white,
    marginBottom: spacing.sm,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: spacing.xl,
  },
  stepsCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.primary },
  stepText: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },
  stepTextDone: { color: 'rgba(255,255,255,0.9)' },
  cancelBtn: {
    margin: spacing.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.full,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
    fontSize: typography.fontSizes.md,
  },
});

