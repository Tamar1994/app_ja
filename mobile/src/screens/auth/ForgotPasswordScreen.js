import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Atenção', 'Informe seu e-mail.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.forgotPassword(trimmed);
      // Sempre navega para a tela de reset — o backend não revela se o e-mail existe
      navigation.navigate('ResetPassword', { email: trimmed });
    } catch {
      Alert.alert('Erro', 'Não foi possível processar a solicitação. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Esqueci minha senha</Text>
        <Text style={styles.headerSub}>Enviaremos um código por e-mail e WhatsApp</Text>
      </LinearGradient>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="lock-open-outline" size={40} color={colors.primary} />
            </View>

            <Text style={styles.desc}>
              Informe o e-mail cadastrado na sua conta. Enviaremos um código de 6 dígitos para redefinir sua senha.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>E-mail</Text>
              <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={focused ? colors.primary : colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="seu@email.com"
                  placeholderTextColor={colors.textLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onSubmitEditing={handleSend}
                  returnKeyType="send"
                />
              </View>
            </View>

            <TouchableOpacity
              style={styles.btn}
              onPress={handleSend}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={loading ? ['#ccc', '#bbb'] : colors.gradientPrimary}
                style={styles.btnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {loading
                  ? <ActivityIndicator color={colors.white} />
                  : <Text style={styles.btnText}>Enviar código</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkWrap} onPress={() => navigation.goBack()}>
              <Text style={styles.link}>Lembrei minha senha</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 55,
    paddingBottom: 36,
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
  headerTitle: {
    fontSize: typography.fontSizes.xxxl,
    fontWeight: '800',
    color: colors.white,
    marginBottom: 4,
  },
  headerSub: {
    fontSize: typography.fontSizes.md,
    color: 'rgba(255,255,255,0.8)',
  },
  scroll: { flexGrow: 1 },
  card: {
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    flex: 1,
    padding: spacing.xl,
    marginTop: -20,
    ...shadows.lg,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  desc: {
    fontSize: typography.fontSizes.md,
    color: colors.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  inputGroup: { gap: 6, marginBottom: spacing.lg },
  label: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    height: 54,
  },
  inputWrapFocused: {
    borderColor: colors.primary,
    backgroundColor: '#FFF8F3',
  },
  inputIcon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
  },
  btn: { borderRadius: borderRadius.lg, overflow: 'hidden' },
  btnGradient: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.white,
  },
  linkWrap: { alignItems: 'center', marginTop: spacing.lg },
  link: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontWeight: '600',
  },
});
