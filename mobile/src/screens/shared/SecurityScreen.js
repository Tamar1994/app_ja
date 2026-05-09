import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, ScrollView,
  TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

function InputField({ label, icon, value, onChangeText, secureTextEntry, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <Ionicons name={icon} size={18} color={colors.textLight} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textLight}
          secureTextEntry={secureTextEntry && !show}
          autoCapitalize="none"
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setShow((s) => !s)} style={{ padding: 4 }}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textLight} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function SecurityScreen({ navigation }) {
  const { logout } = useAuth();

  // — Alterar senha —
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // — Excluir conta —
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return Alert.alert('Atenção', 'Preencha todos os campos de senha.');
    }
    if (newPassword.length < 6) {
      return Alert.alert('Atenção', 'A nova senha deve ter pelo menos 6 caracteres.');
    }
    if (newPassword !== confirmPassword) {
      return Alert.alert('Atenção', 'A nova senha e a confirmação não coincidem.');
    }
    if (newPassword === currentPassword) {
      return Alert.alert('Atenção', 'A nova senha deve ser diferente da atual.');
    }
    setSavingPassword(true);
    try {
      await userAPI.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Sucesso', 'Senha alterada com sucesso!');
    } catch (err) {
      const msg = err?.response?.data?.message || 'Erro ao alterar senha. Tente novamente.';
      Alert.alert('Erro', msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Excluir conta',
      'Esta ação é permanente e não pode ser desfeita. Todos os seus dados serão removidos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            if (!deletePassword) {
              return Alert.alert('Atenção', 'Digite sua senha para confirmar.');
            }
            setDeletingAccount(true);
            try {
              await userAPI.deleteAccount(deletePassword);
              Alert.alert('Conta excluída', 'Sua conta foi removida com sucesso.', [
                { text: 'OK', onPress: logout },
              ]);
            } catch (err) {
              const msg = err?.response?.data?.message || 'Erro ao excluir conta. Tente novamente.';
              Alert.alert('Erro', msg);
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* Header */}
        <LinearGradient
          colors={['#FF8C38', '#FF6B00', '#E55A00']}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Segurança e Privacidade</Text>
          <View style={{ width: 38 }} />
        </LinearGradient>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* — Alterar senha — */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconBg}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>Alterar senha</Text>
            </View>

            <View style={styles.card}>
              <InputField
                label="Senha atual"
                icon="lock-closed-outline"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                placeholder="Digite sua senha atual"
              />
              <View style={styles.divider} />
              <InputField
                label="Nova senha"
                icon="lock-open-outline"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Mínimo 6 caracteres"
              />
              <View style={styles.divider} />
              <InputField
                label="Confirmar nova senha"
                icon="checkmark-circle-outline"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Repita a nova senha"
              />

              <TouchableOpacity
                style={styles.btnWrap}
                onPress={handleChangePassword}
                disabled={savingPassword}
                activeOpacity={0.85}
              >
                <LinearGradient colors={colors.gradientPrimary} style={styles.btn}>
                  {savingPassword
                    ? <ActivityIndicator color={colors.white} />
                    : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color={colors.white} />
                        <Text style={styles.btnText}>Salvar nova senha</Text>
                      </>
                    )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          {/* — Privacidade — */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconBg}>
                <Ionicons name="shield-outline" size={20} color={colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>Privacidade</Text>
            </View>

            <View style={styles.card}>
              {[
                { icon: 'location-outline', label: 'Localização', desc: 'Usada apenas durante serviços ativos' },
                { icon: 'camera-outline', label: 'Câmera', desc: 'Usada para envio de documentos' },
                { icon: 'notifications-outline', label: 'Notificações', desc: 'Para avisos de pedidos e atualizações' },
              ].map((item, i, arr) => (
                <View key={i} style={[styles.privacyRow, i < arr.length - 1 && styles.divider]}>
                  <View style={styles.privacyIcon}>
                    <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyLabel}>{item.label}</Text>
                    <Text style={styles.privacyDesc}>{item.desc}</Text>
                  </View>
                  <View style={styles.privacyBadge}>
                    <Text style={styles.privacyBadgeText}>Ativo</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* — Zona de perigo — */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconBg, { backgroundColor: '#FFEBEE' }]}>
                <Ionicons name="warning-outline" size={20} color={colors.error} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.error }]}>Zona de perigo</Text>
            </View>

            <View style={[styles.card, styles.dangerCard]}>
              <Text style={styles.dangerTitle}>Excluir minha conta</Text>
              <Text style={styles.dangerDesc}>
                Esta ação é permanente. Todos os seus dados, histórico e informações serão removidos e não poderão ser recuperados.
              </Text>

              <InputField
                label="Digite sua senha para confirmar"
                icon="lock-closed-outline"
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                placeholder="Sua senha atual"
              />

              <TouchableOpacity
                style={styles.dangerBtnWrap}
                onPress={handleDeleteAccount}
                disabled={deletingAccount}
                activeOpacity={0.85}
              >
                {deletingAccount
                  ? <ActivityIndicator color={colors.error} />
                  : (
                    <View style={styles.dangerBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                      <Text style={styles.dangerBtnText}>Excluir minha conta</Text>
                    </View>
                  )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 55,
    paddingBottom: 20,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.white,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 40, gap: spacing.lg },

  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIconBg: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#FFF0E6',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    ...shadows.md,
  },
  dangerCard: {
    borderWidth: 1.5,
    borderColor: colors.error + '30',
    backgroundColor: '#FFF8F8',
  },

  inputWrap: { paddingVertical: 12 },
  inputLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    height: 44,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
  },

  divider: { height: 1, backgroundColor: colors.divider },

  btnWrap: { marginTop: spacing.md, borderRadius: borderRadius.full, overflow: 'hidden' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  btnText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.md },

  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  privacyIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  privacyContent: { flex: 1, minWidth: 0, paddingRight: 8 },
  privacyLabel: { fontSize: typography.fontSizes.md, fontWeight: '600', color: colors.textPrimary },
  privacyDesc: { fontSize: typography.fontSizes.xs, color: colors.textLight, marginTop: 2 },
  privacyBadge: {
    backgroundColor: '#E8F5E9', borderRadius: borderRadius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    marginLeft: 'auto',
    alignSelf: 'center',
  },
  privacyBadgeText: { fontSize: 11, color: '#2E7D32', fontWeight: '600' },

  dangerTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.error,
    marginBottom: 6,
    marginTop: spacing.md,
  },
  dangerDesc: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  dangerBtnWrap: {
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.error + '50',
    borderRadius: borderRadius.full,
    padding: 14,
    alignItems: 'center',
  },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dangerBtnText: { color: colors.error, fontWeight: '700', fontSize: typography.fontSizes.md },
});
