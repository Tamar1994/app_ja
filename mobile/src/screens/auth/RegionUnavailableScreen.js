import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, StatusBar, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function RegionUnavailableScreen({ city, state, coordinates }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [submitStatus, setSubmitStatus] = useState('idle'); // 'idle' | 'loading' | 'success'

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(36)).current;
  const iconAnim  = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
      Animated.spring(iconAnim,  { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@') || !trimmed.includes('.')) {
      Alert.alert('E-mail inválido', 'Por favor, informe um e-mail válido para ser notificado.');
      return;
    }

    setSubmitStatus('loading');
    try {
      await requestAPI.registerInterest({
        city,
        state,
        coordinates: Array.isArray(coordinates) ? coordinates : null,
        email: trimmed.toLowerCase(),
      });
      setSubmitStatus('success');
    } catch {
      Alert.alert('Erro', 'Não foi possível registrar seu e-mail. Tente novamente.');
      setSubmitStatus('idle');
    }
  };

  const displayCity = city || 'sua região';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={['#1A1A2E', '#16213E', '#0F3460']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Efeitos de fundo decorativos */}
      <View style={[styles.decCircle1, { top: insets.top + 20 }]} />
      <View style={styles.decCircle2} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Ícone animado */}
            <Animated.View style={[styles.iconWrap, { transform: [{ scale: iconAnim }] }]}>
              <LinearGradient
                colors={['rgba(255,107,0,0.3)', 'rgba(255,107,0,0.1)']}
                style={styles.iconBg}
              >
                <Ionicons name="map-outline" size={52} color="#FF8C38" />
              </LinearGradient>
            </Animated.View>

            {/* Logo / Badge */}
            <View style={styles.badge}>
              <Text style={styles.badgeText}>JÁ!</Text>
            </View>

            {/* Textos principais */}
            <Text style={styles.title}>
              Ainda não chegamos{'\n'}em{' '}
              <Text style={styles.titleHighlight}>{displayCity}</Text>
            </Text>

            <Text style={styles.subtitle}>
              Estamos crescendo rápido e em breve estaremos na sua cidade!
              Cadastre seu e-mail abaixo e você será um dos primeiros a saber.
            </Text>

            {/* Bullet points de benefícios */}
            <View style={styles.bullets}>
              {[
                { icon: 'notifications-outline', text: 'Aviso por e-mail assim que chegar' },
                { icon: 'gift-outline',           text: 'Desconto especial para pioneiros' },
                { icon: 'shield-checkmark-outline', text: 'Sem spam — prometemos!' },
              ].map((item, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletIcon}>
                    <Ionicons name={item.icon} size={16} color="#FF8C38" />
                  </View>
                  <Text style={styles.bulletText}>{item.text}</Text>
                </View>
              ))}
            </View>

            {/* Formulário de captura */}
            {submitStatus === 'success' ? (
              <View style={styles.successCard}>
                <View style={styles.successIconWrap}>
                  <Ionicons name="checkmark-circle" size={40} color="#4CAF50" />
                </View>
                <Text style={styles.successTitle}>Você está na lista! 🎉</Text>
                <Text style={styles.successText}>
                  Avisaremos em <Text style={{ color: '#FF8C38', fontWeight: '700' }}>{email}</Text>{' '}
                  assim que a JÁ! chegar em {displayCity}.
                </Text>
              </View>
            ) : (
              <View style={styles.formCard}>
                <Text style={styles.formLabel}>Seu melhor e-mail</Text>
                <TextInput
                  style={styles.input}
                  placeholder="voce@exemplo.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                  editable={submitStatus !== 'loading'}
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                />

                <TouchableOpacity
                  style={[styles.btn, submitStatus === 'loading' && styles.btnDisabled]}
                  onPress={handleSubmit}
                  activeOpacity={0.85}
                  disabled={submitStatus === 'loading'}
                >
                  <LinearGradient
                    colors={['#FF8C38', '#FF6B00', '#E55A00']}
                    style={styles.btnGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    {submitStatus === 'loading' ? (
                      <Ionicons name="hourglass-outline" size={20} color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="mail-outline" size={18} color="#fff" />
                        <Text style={styles.btnText}>Me avise quando chegar!</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.footer}>
              Nunca compartilharemos seu e-mail com terceiros.{'\n'}
              © 2026 JÁ! Intermediação de Serviços Digitais.
            </Text>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  decCircle1: {
    position: 'absolute',
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,107,0,0.07)',
  },
  decCircle2: {
    position: 'absolute',
    bottom: 80,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(15,52,96,0.4)',
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    paddingHorizontal: spacing.xl || 24,
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: 20,
  },
  iconBg: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.2)',
  },
  badge: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 2,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 16,
    letterSpacing: -0.4,
  },
  titleHighlight: {
    color: '#FF8C38',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  bullets: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,140,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  formCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 24,
    gap: 12,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
  },
  btn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 24,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  successCard: {
    width: '100%',
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.25)',
    marginBottom: 24,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(76,175,80,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  successText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 18,
  },
});
