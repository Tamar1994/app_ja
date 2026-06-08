import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius, typography } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const emailTrimmed = email.trim().toLowerCase();
    if (!emailTrimmed || !password) {
      Alert.alert('Atenção', 'Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    try {
      await login(emailTrimmed, password);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Credenciais inválidas. Verifique e tente novamente.';
      Alert.alert('Acesso negado', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={['#0D47A1', '#1565C0', '#1976D2']} style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Logo / Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="headset" size={42} color={colors.primary} />
          </View>
          <Text style={styles.appName}>Já! Suporte</Text>
          <Text style={styles.appSub}>Painel interno de atendimento</Text>
        </View>

        {/* Card de login */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Entrar</Text>
          <Text style={styles.cardSub}>Acesso restrito à equipe de suporte</Text>

          {/* E-mail */}
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.textLight} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="E-mail"
              placeholderTextColor={colors.textLight}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          {/* Senha */}
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textLight} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Senha"
              placeholderTextColor={colors.textLight}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={colors.textLight}
              />
            </TouchableOpacity>
          </View>

          {/* Botão */}
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#1976D2', '#0D47A1']} style={styles.loginBtnGrad}>
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="log-in-outline" size={20} color={colors.white} />
                    <Text style={styles.loginBtnText}>Entrar</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>Uso interno exclusivo — não compartilhe</Text>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  appName: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
  },
  appSub: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cardTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.background,
    minHeight: 50,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  eyeBtn: { padding: 6 },
  loginBtn: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  loginBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  loginBtnText: {
    color: colors.white,
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSizes.xs,
    marginTop: spacing.xl,
  },
});
