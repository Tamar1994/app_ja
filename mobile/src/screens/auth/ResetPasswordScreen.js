import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function ResetPasswordScreen({ navigation, route }) {
  const { email } = route.params;

  const [code, setCode]           = useState('');
  const [newPass, setNewPass]     = useState('');
  const [confirmPass, setConfirm] = useState('');
  const [showNew, setShowNew]     = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [focused, setFocused]     = useState(null);

  const passRef   = useRef(null);
  const confirmRef = useRef(null);

  const handleReset = async () => {
    if (!code.trim() || code.length !== 6) {
      Alert.alert('Atenção', 'Informe o código de 6 dígitos.');
      return;
    }
    if (newPass.length < 6) {
      Alert.alert('Atenção', 'A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPass !== confirmPass) {
      Alert.alert('Atenção', 'As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.resetPassword(email, code.trim(), newPass);
      Alert.alert(
        'Senha redefinida!',
        'Sua senha foi alterada com sucesso. Faça login com a nova senha.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Código incorreto ou expirado.';
      Alert.alert('Erro', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await authAPI.forgotPassword(email);
      Alert.alert('Código reenviado', 'Verifique seu e-mail e WhatsApp.');
    } catch {
      Alert.alert('Erro', 'Não foi possível reenviar o código.');
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
        <Text style={styles.headerTitle}>Redefinir senha</Text>
        <Text style={styles.headerSub}>Código enviado para {email}</Text>
      </LinearGradient>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>

            {/* Código */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Código de verificação</Text>
              <View style={[styles.inputWrap, focused === 'code' && styles.inputWrapFocused]}>
                <Ionicons
                  name="key-outline"
                  size={20}
                  color={focused === 'code' ? colors.primary : colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={colors.textLight}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={setCode}
                  onFocus={() => setFocused('code')}
                  onBlur={() => setFocused(null)}
                  returnKeyType="next"
                  onSubmitEditing={() => passRef.current?.focus()}
                />
              </View>
            </View>

            {/* Nova senha */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nova senha</Text>
              <View style={[styles.inputWrap, focused === 'pass' && styles.inputWrapFocused]}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focused === 'pass' ? colors.primary : colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={passRef}
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Mínimo 6 caracteres"
                  placeholderTextColor={colors.textLight}
                  secureTextEntry={!showNew}
                  value={newPass}
                  onChangeText={setNewPass}
                  onFocus={() => setFocused('pass')}
                  onBlur={() => setFocused(null)}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />
                <TouchableOpacity onPress={() => setShowNew(!showNew)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showNew ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textLight}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirmar senha */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirmar nova senha</Text>
              <View style={[styles.inputWrap, focused === 'conf' && styles.inputWrapFocused]}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focused === 'conf' ? colors.primary : colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={confirmRef}
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Repita a nova senha"
                  placeholderTextColor={colors.textLight}
                  secureTextEntry={!showConf}
                  value={confirmPass}
                  onChangeText={setConfirm}
                  onFocus={() => setFocused('conf')}
                  onBlur={() => setFocused(null)}
                  returnKeyType="done"
                  onSubmitEditing={handleReset}
                />
                <TouchableOpacity onPress={() => setShowConf(!showConf)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showConf ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textLight}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.btn}
              onPress={handleReset}
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
                  : <Text style={styles.btnText}>Redefinir senha</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkWrap} onPress={handleResend}>
              <Text style={styles.link}>Não recebi o código — reenviar</Text>
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
    fontSize: typography.fontSizes.sm,
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
    gap: spacing.md,
    ...shadows.lg,
  },
  inputGroup: { gap: 6 },
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
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
  eyeBtn: { padding: 4 },
  btn: { borderRadius: borderRadius.lg, overflow: 'hidden', marginTop: spacing.sm },
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
  linkWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  link: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary,
    fontWeight: '600',
  },
});
