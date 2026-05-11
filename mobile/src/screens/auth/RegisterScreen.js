import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.15.17:3000/api';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [userType, setUserType] = useState('client');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [selectedProfessions, setSelectedProfessions] = useState([]);

  const toggleProfession = (id) => {
    setSelectedProfessions((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    setLoadingTypes(true);
    fetch(`${BASE_URL}/service-types`)
      .then(r => r.json())
      .then(data => setServiceTypes(data.serviceTypes || []))
      .catch(() => {})
      .finally(() => setLoadingTypes(false));
  }, []);

  const maskCPF = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  };

  const maskDate = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 8);
    return digits
      .replace(/(\d{2})(\d)/, '$1/$2')
      .replace(/(\d{2})(\d)/, '$1/$2');
  };

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !phone.trim() || !password || !cpf || !birthDate) {
      Alert.alert('Atenção', 'Preencha todos os campos obrigatórios.');
      return;
    }
    const cpfDigits = cpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) {
      Alert.alert('Atenção', 'CPF inválido. Insira os 11 dígitos.');
      return;
    }
    const parts = birthDate.split('/');
    if (parts.length !== 3 || parts[2].length !== 4) {
      Alert.alert('Atenção', 'Data de nascimento inválida. Use DD/MM/AAAA.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (userType === 'professional' && selectedProfessions.length === 0) {
      Alert.alert('Atenção', 'Selecione sua profissão para continuar.');
      return;
    }
    setLoading(true);
    try {
      const [day, month, year] = birthDate.split('/');
      const data = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        userType,
        cpf: cpfDigits,
        birthDate: `${year}-${month}-${day}`,
      };
      if (userType === 'professional') {
        const selectedType = serviceTypes.find((t) => t._id === selectedProfessions[0]);
        if (selectedType) data.serviceTypeSlug = selectedType.slug;
      }
      await register(data);
      navigation.navigate('VerifyEmail', { email: email.trim().toLowerCase() });
    } catch (err) {
      const errors = err.response?.data?.errors;
      if (errors?.length) {
        Alert.alert('Erro', errors[0].msg);
      } else {
        Alert.alert('Erro', err.response?.data?.message || 'Erro ao cadastrar. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { label: 'Nome completo', key: 'name', icon: 'person-outline', placeholder: 'Seu nome completo', keyboard: 'default', setter: setName, value: name },
    { label: 'E-mail', key: 'email', icon: 'mail-outline', placeholder: 'seu@email.com', keyboard: 'email-address', setter: setEmail, value: email, autoCapitalize: 'none' },
    { label: 'Telefone / WhatsApp', key: 'phone', icon: 'call-outline', placeholder: '(11) 99999-9999', keyboard: 'phone-pad', setter: setPhone, value: phone },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Criar conta</Text>
        <Text style={styles.headerSub}>É rápido e gratuito!</Text>
      </LinearGradient>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {/* Seletor de tipo */}
            <Text style={styles.sectionLabel}>Como vai usar o Já!?</Text>
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeBtn, userType === 'client' && styles.typeBtnActive]}
                onPress={() => setUserType('client')}
                activeOpacity={0.8}
              >
                {userType === 'client' ? (
                  <LinearGradient colors={colors.gradientPrimary} style={styles.typeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Ionicons name="home" size={20} color={colors.white} />
                    <Text style={[styles.typeBtnText, styles.typeBtnTextActive]}>Cliente</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.typeInner}>
                    <Ionicons name="home-outline" size={20} color={colors.textSecondary} />
                    <Text style={styles.typeBtnText}>Cliente</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, userType === 'professional' && styles.typeBtnActivePro]}
                onPress={() => setUserType('professional')}
                activeOpacity={0.8}
              >
                {userType === 'professional' ? (
                  <LinearGradient colors={colors.gradientSecondary} style={styles.typeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Ionicons name="briefcase" size={20} color={colors.white} />
                    <Text style={[styles.typeBtnText, styles.typeBtnTextActive]}>Profissional</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.typeInner}>
                    <Ionicons name="briefcase-outline" size={20} color={colors.textSecondary} />
                    <Text style={styles.typeBtnText}>Profissional</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.form}>
              {fields.map((field) => (
                <View key={field.key} style={styles.inputGroup}>
                  <Text style={styles.label}>{field.label}</Text>
                  <View style={[styles.inputWrap, focusedField === field.key && styles.inputWrapFocused]}>
                    <Ionicons
                      name={field.icon}
                      size={20}
                      color={focusedField === field.key ? colors.primary : colors.textLight}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={field.placeholder}
                      placeholderTextColor={colors.textLight}
                      keyboardType={field.keyboard}
                      autoCapitalize={field.autoCapitalize || 'words'}
                      autoCorrect={false}
                      value={field.value}
                      onChangeText={field.setter}
                      onFocus={() => setFocusedField(field.key)}
                      onBlur={() => setFocusedField(null)}
                    />
                  </View>
                </View>
              ))}

              {/* CPF */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>CPF</Text>
                <View style={[styles.inputWrap, focusedField === 'cpf' && styles.inputWrapFocused]}>
                  <Ionicons
                    name="card-outline"
                    size={20}
                    color={focusedField === 'cpf' ? colors.primary : colors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="000.000.000-00"
                    placeholderTextColor={colors.textLight}
                    keyboardType="numeric"
                    value={cpf}
                    onChangeText={(v) => setCpf(maskCPF(v))}
                    onFocus={() => setFocusedField('cpf')}
                    onBlur={() => setFocusedField(null)}
                    maxLength={14}
                  />
                </View>
              </View>

              {/* Data de nascimento */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Data de nascimento</Text>
                <View style={[styles.inputWrap, focusedField === 'birth' && styles.inputWrapFocused]}>
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={focusedField === 'birth' ? colors.primary : colors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor={colors.textLight}
                    keyboardType="numeric"
                    value={birthDate}
                    onChangeText={(v) => setBirthDate(maskDate(v))}
                    onFocus={() => setFocusedField('birth')}
                    onBlur={() => setFocusedField(null)}
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Senha */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Senha</Text>
                <View style={[styles.inputWrap, focusedField === 'pass' && styles.inputWrapFocused]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={focusedField === 'pass' ? colors.primary : colors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={colors.textLight}
                    secureTextEntry={!showPass}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocusedField('pass')}
                    onBlur={() => setFocusedField(null)}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textLight} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Seletor de profissões (só profissional) */}
              {userType === 'professional' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Suas profissões *</Text>
                  {loadingTypes ? (
                    <ActivityIndicator color={colors.secondary} style={{ marginTop: 8 }} />
                  ) : serviceTypes.length === 0 ? (
                    <Text style={styles.profEmpty}>Nenhuma profissão disponível no momento.</Text>
                  ) : (
                    <View>
                      {serviceTypes.map((item) => (
                        <TouchableOpacity
                          key={item._id}
                          style={[styles.professionItem, selectedProfessions.includes(item._id) && styles.professionItemSelected]}
                          onPress={() => toggleProfession(item._id)}
                        >
                          <Text style={styles.professionText}>{item.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity style={styles.btnPrimary} onPress={handleRegister} disabled={loading} activeOpacity={0.85}>
                <LinearGradient
                  colors={loading ? ['#ccc', '#bbb'] : (userType === 'professional' ? colors.gradientSecondary : colors.gradientPrimary)}
                  style={styles.btnGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {loading
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.btnPrimaryText}>Criar minha conta</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Já tem conta? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.footerLink}>Entrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerGradient: {
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
  },
  sectionLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  typeBtn: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  typeBtnActive: {
    borderColor: colors.primary,
  },
  typeBtnActivePro: {
    borderColor: colors.secondary,
  },
  typeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  typeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    backgroundColor: colors.background,
  },
  typeBtnText: {
    fontSize: typography.fontSizes.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  typeBtnTextActive: { color: colors.white },
  form: { gap: spacing.md },
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
  inputWrapFocusedPro: {
    borderColor: colors.secondary,
    backgroundColor: '#F3F6FC',
  },
  inputIcon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
  },
  priceSuffix: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
    fontWeight: '500',
  },
  btnPrimary: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginTop: spacing.sm,
    ...shadows.primary,
  },
  btnGradient: {
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: colors.white,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl, paddingBottom: 20 },
  footerText: { color: colors.textSecondary, fontSize: typography.fontSizes.md },
  footerLink: {
    color: colors.primary,
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
  },
  profGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  profCard: {
    width: '47%',
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  profCardSelected: {
    borderColor: colors.secondary,
    backgroundColor: '#EFF6FF',
  },
  profCardDisabled: {
    opacity: 0.45,
  },
  profIcon: { fontSize: 28 },
  profName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  profNameSelected: { color: colors.secondary },
  profNameDisabled: { color: colors.textLight },
  profSoon: {
    fontSize: 10,
    color: colors.textLight,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontWeight: '500',
  },
  profCheck: { position: 'absolute', top: 8, right: 8 },
  profHint: { fontSize: 11, color: colors.primary, marginTop: 4, marginLeft: 2 },
  profEmpty: { fontSize: typography.fontSizes.sm, color: colors.textLight, marginTop: 6 },
});
