import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function VerifyEmailScreen({ navigation, route }) {
  const { email } = route.params;
  const { verifyEmail, resendVerification } = useAuth();

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const inputs = useRef([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleChange = (val, idx) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...code];
    next[idx] = val;
    setCode(next);
    if (val && idx < 5) inputs.current[idx + 1]?.focus();
    if (!val && idx > 0) inputs.current[idx - 1]?.focus();
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length < 6) {
      Alert.alert('Atenção', 'Digite o código de 6 dígitos completo.');
      return;
    }
    setLoading(true);
    try {
      await verifyEmail(email, fullCode);
      // AuthContext atualiza user → RootNavigator redireciona automaticamente
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Código inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setResending(true);
    try {
      await resendVerification(email);
      setCountdown(60);
      setCode(['', '', '', '', '', '']);
      Alert.alert('Enviado!', 'Um novo código foi enviado para seu e-mail.');
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Erro ao reenviar código.');
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={['#1A1A2E', '#16213E', '#E05A00']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={52} color={colors.primary} />
        </View>

        <Text style={styles.title}>Verifique seu e-mail</Text>
        <Text style={styles.subtitle}>
          Enviamos um código de 6 dígitos para{'\n'}
          <Text style={styles.emailText}>{email}</Text>
        </Text>

        {/* Inputs do código */}
        <View style={styles.codeRow}>
          {code.map((digit, idx) => (
            <TextInput
              key={idx}
              ref={(r) => (inputs.current[idx] = r)}
              style={[styles.codeInput, digit ? styles.codeInputFilled : null]}
              value={digit}
              onChangeText={(val) => handleChange(val, idx)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              textAlign="center"
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btnVerify, loading && { opacity: 0.7 }]}
          onPress={handleVerify}
          disabled={loading}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={colors.gradientPrimary}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {loading
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.btnText}>Confirmar código</Text>
            }
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resendBtn, (countdown > 0 || resending) && { opacity: 0.5 }]}
          onPress={handleResend}
          disabled={countdown > 0 || resending}
        >
          {resending
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text style={styles.resendText}>
                {countdown > 0
                  ? `Reenviar código em ${countdown}s`
                  : 'Reenviar código'}
              </Text>
          }
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A1A2E' },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 60,
  },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,107,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.25)',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.white,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  emailText: {
    color: colors.primaryLight,
    fontWeight: '700',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.xl,
  },
  codeInput: {
    width: 46,
    height: 58,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    fontSize: 24,
    fontWeight: '800',
    color: colors.white,
  },
  codeInputFilled: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255,107,0,0.12)',
  },
  btnVerify: {
    width: '100%',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...shadows.md,
  },
  btnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.3,
  },
  resendBtn: {
    paddingVertical: 10,
  },
  resendText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primaryLight,
    fontWeight: '600',
  },
});
