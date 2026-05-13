import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function ProfessionalAddressScreen({ navigation, route }) {
  const { setUser } = useAuth();
  // upgradeMode=true quando é um CLIENTE ativando perfil profissional
  const upgradeMode = route?.params?.upgradeMode === true;

  const [zipCode, setZipCode]         = useState('');
  const [street, setStreet]           = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity]               = useState('');
  const [state, setState]             = useState('');
  const [complement, setComplement]   = useState('');

  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ViaCEP — mesmo padrão do RequestServiceScreen
  const fetchViaCep = async (rawCep) => {
    const cep = rawCep.replace(/\D/g, '');
    if (cep.length !== 8) {
      setCepError('');
      return;
    }
    setCepLoading(true);
    setCepError('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (data.erro) {
        setCepError('CEP não encontrado.');
        return;
      }
      setStreet(data.logradouro || '');
      setNeighborhood(data.bairro || '');
      setCity(data.localidade || '');
      setState(data.uf || '');
    } catch {
      setCepError('Não foi possível consultar o CEP. Verifique sua conexão.');
    } finally {
      setCepLoading(false);
    }
  };

  const handleZipChange = (val) => {
    setZipCode(val);
    fetchViaCep(val);
  };

  const handleSave = async () => {
    if (!zipCode || !street || !city || !state) {
      Alert.alert('Atenção', 'Preencha CEP, rua, cidade e estado para continuar.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await authAPI.saveProfessionalAddress({
        zipCode, street, neighborhood, city, state, complement,
      });
      if (setUser) setUser(data.user);
      if (upgradeMode && navigation) {
        // Cliente no fluxo de upgrade → vai direto para enviar comprovante de residência
        navigation.replace('ProfessionalUpgrade');
      }
      // Profissional puro: RootNavigator re-renderiza automaticamente
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível salvar o endereço. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <LinearGradient
        colors={['#FF8C38', '#FF6B00', '#E55A00']}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headerContent}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="location" size={32} color={colors.white} />
            </View>
            <Text style={styles.headerTitle}>Endereço Residencial</Text>
            <Text style={styles.headerSub}>
              Precisamos do seu endereço para operar na sua região
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {/* CEP com ViaCEP */}
            <Text style={styles.label}>CEP *</Text>
            <View style={styles.cepRow}>
              <TextInput
                style={[styles.input, styles.cepInput]}
                value={zipCode}
                onChangeText={handleZipChange}
                placeholder="00000-000"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
                maxLength={9}
                returnKeyType="next"
              />
              {cepLoading && (
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={styles.cepSpinner}
                />
              )}
            </View>
            {!!cepError && <Text style={styles.cepErrorText}>{cepError}</Text>}

            {/* Rua */}
            <Text style={styles.label}>Rua / Avenida *</Text>
            <TextInput
              style={styles.input}
              value={street}
              onChangeText={setStreet}
              placeholder="Nome da rua"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />

            {/* Bairro */}
            <Text style={styles.label}>Bairro</Text>
            <TextInput
              style={styles.input}
              value={neighborhood}
              onChangeText={setNeighborhood}
              placeholder="Bairro"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />

            {/* Cidade e Estado em linha */}
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Cidade *</Text>
                <TextInput
                  style={styles.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="Cidade"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="next"
                />
              </View>
              <View style={{ width: 70 }}>
                <Text style={styles.label}>UF *</Text>
                <TextInput
                  style={styles.input}
                  value={state}
                  onChangeText={(v) => setState(v.toUpperCase().slice(0, 2))}
                  placeholder="SP"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={2}
                  autoCapitalize="characters"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Complemento */}
            <Text style={styles.label}>Complemento</Text>
            <TextInput
              style={styles.input}
              value={complement}
              onChangeText={setComplement}
              placeholder="Apartamento, bloco, etc. (opcional)"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
            />

            <Text style={styles.hint}>
              * Campos obrigatórios. Seu endereço é usado apenas para definir sua área de atuação.
            </Text>
          </View>

          {/* Botão Salvar */}
          <TouchableOpacity
            style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <LinearGradient
                colors={['#FF8C38', '#FF6B00']}
                style={styles.saveBtnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="checkmark-circle" size={20} color={colors.white} />
                <Text style={styles.saveBtnText}>Salvar e Continuar</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingBottom: spacing.xl,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  headerIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.white,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSub: {
    ...typography.body,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginTop: 4,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceHover || 'rgba(255,255,255,0.06)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border || 'rgba(255,255,255,0.1)',
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  cepRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cepInput: {
    flex: 1,
  },
  cepSpinner: {
    position: 'absolute',
    right: 14,
  },
  cepErrorText: {
    fontSize: 12,
    color: colors.error || '#EF4444',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hint: {
    fontSize: 12,
    color: colors.textTertiary || colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
  saveBtn: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  saveBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
});
