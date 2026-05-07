import React, { useRef, useEffect } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity,
  StatusBar, Animated, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const { width, height } = Dimensions.get('window');

export default function OnboardingScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={['#1A1A2E', '#16213E', '#E05A00']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
      />

      {/* Círculos decorativos */}
      <View style={styles.circle1} />
      <View style={styles.circle2} />

      {/* Conteúdo principal */}
      <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.logoWrap}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.tagline}>Serviços domésticos{'\n'}na palma da sua mão</Text>
        <Text style={styles.subtitle}>
          Contrate diaristas de confiança, acompanhe em tempo real e pague pelo app com total segurança.
        </Text>

        {/* Features rápidas */}
        <View style={styles.features}>
          {[
            { icon: 'shield-checkmark-outline', text: 'Profissionais verificados' },
            { icon: 'location-outline', text: 'Próximos a você' },
            { icon: 'card-outline', text: 'Pagamento seguro' },
          ].map((f, i) => (
            <View key={i} style={styles.feature}>
              <Ionicons name={f.icon} size={16} color={colors.primaryLight} />
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Botões */}
      <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => navigation.navigate('Register')}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={colors.gradientPrimary}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.btnPrimaryText}>Começar agora</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
        >
          <Text style={styles.btnSecondaryText}>Já tenho conta</Text>
        </TouchableOpacity>

        <Text style={styles.terms}>
          Ao continuar, você concorda com nossos{' '}
          <Text style={styles.termsLink}>Termos de Uso</Text>
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  circle1: {
    position: 'absolute',
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: 'rgba(255,107,0,0.08)',
    top: -width * 0.2,
    right: -width * 0.2,
  },
  circle2: {
    position: 'absolute',
    width: width * 0.5,
    height: width * 0.5,
    borderRadius: width * 0.25,
    backgroundColor: 'rgba(255,140,56,0.06)',
    bottom: height * 0.25,
    left: -width * 0.1,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 60,
  },
  logoWrap: {
    width: 150,
    height: 150,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.lg,
  },
  logo: {
    width: 120,
    height: 120,
  },
  tagline: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 42,
    marginBottom: spacing.md,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  features: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  featureText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: typography.fontSizes.sm,
    fontWeight: '500',
  },
  actions: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 40,
    gap: spacing.sm,
  },
  btnPrimary: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    ...shadows.primary,
  },
  btnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
    gap: spacing.sm,
  },
  btnPrimaryText: {
    color: colors.white,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  btnSecondary: {
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: borderRadius.full,
  },
  btnSecondaryText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: typography.fontSizes.lg,
    fontWeight: '600',
  },
  terms: {
    textAlign: 'center',
    fontSize: typography.fontSizes.xs,
    color: 'rgba(255,255,255,0.35)',
    marginTop: spacing.xs,
  },
  termsLink: {
    color: colors.primaryLight,
    textDecorationLine: 'underline',
  },
});

