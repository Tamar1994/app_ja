import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, StatusBar,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { userAPI, uploadAPI, serviceTypeAPI } from '../../services/api';
import { colors, typography } from '../../theme';

export default function ProfileEditScreen({ navigation }) {
  const { user, refreshUser } = useAuth();

  // ── Professions ──────────────────────────────────────────────────
  const [serviceTypes, setServiceTypes] = useState([]);
  const [selectedSlugs, setSelectedSlugs] = useState([]);
  const [savingProfessions, setSavingProfessions] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);

  // ── Address ──────────────────────────────────────────────────────
  const [addressUpdateEnabled, setAddressUpdateEnabled] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [checkingPending, setCheckingPending] = useState(true);
  const [addressForm, setAddressForm] = useState({
    street: '', neighborhood: '', city: '', state: '', zipCode: '', complement: '',
  });
  const [proofFile, setProofFile] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadedProofUrl, setUploadedProofUrl] = useState(null);
  const [submittingAddress, setSubmittingAddress] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);

  useEffect(() => {
    loadServiceTypes();
    loadAddressStatus();
  }, []);

  const loadServiceTypes = async () => {
    try {
      const res = await serviceTypeAPI.list();
      const enabled = (res.data.serviceTypes || []).filter((t) => t.status === 'enabled');
      setServiceTypes(enabled);
      // Pre-select current professions
      const current =
        user.serviceTypeSlugs?.length > 0
          ? user.serviceTypeSlugs
          : user.serviceTypeSlug
          ? [user.serviceTypeSlug]
          : [];
      setSelectedSlugs(current);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar as profissões.');
    } finally {
      setLoadingTypes(false);
    }
  };

  const loadAddressStatus = async () => {
    try {
      const res = await userAPI.getAddressUpdateStatus();
      if (res.data.pending) setPendingRequest(res.data.request);
    } catch {}
    setCheckingPending(false);
  };

  // ── Professions handlers ─────────────────────────────────────────
  const toggleSlug = (slug) => {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const saveProfessions = async () => {
    if (selectedSlugs.length === 0) {
      Alert.alert('Atenção', 'Selecione ao menos uma profissão.');
      return;
    }
    setSavingProfessions(true);
    try {
      await userAPI.updateProfessions(selectedSlugs);
      await refreshUser();
      Alert.alert('Sucesso', 'Profissões atualizadas!');
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível atualizar as profissões.');
    } finally {
      setSavingProfessions(false);
    }
  };

  // ── Address handlers ─────────────────────────────────────────────
  const lookupCep = async () => {
    const cep = addressForm.zipCode.replace(/\D/g, '');
    if (cep.length !== 8) { Alert.alert('CEP inválido', 'Digite um CEP com 8 dígitos.'); return; }
    setLookingUpCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) { Alert.alert('CEP não encontrado', 'Verifique o CEP digitado.'); return; }
      setAddressForm((p) => ({
        ...p,
        street: data.logradouro || p.street,
        neighborhood: data.bairro || p.neighborhood,
        city: data.localidade || p.city,
        state: data.uf || p.state,
      }));
    } catch {
      Alert.alert('Erro', 'Não foi possível consultar o CEP.');
    } finally {
      setLookingUpCep(false);
    }
  };

  const pickProof = () => {
    Alert.alert('Comprovante de endereço', 'Escolha o formato', [
      { text: 'Imagem da galeria', onPress: pickImageProof },
      { text: 'Câmera', onPress: takePhotoProof },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickImageProof = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão necessária', 'Precisamos de acesso à galeria.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) uploadProofAsset(result.assets[0]);
  };

  const takePhotoProof = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) uploadProofAsset(result.assets[0]);
  };

  const uploadProofAsset = async (asset) => {
    setUploadingProof(true);
    try {
      const ext = asset.uri.split('.').pop() || 'jpg';
      const formData = new FormData();
      formData.append('proof', {
        uri: asset.uri,
        name: asset.name || `proof.${ext}`,
        type: asset.mimeType || `image/${ext}`,
      });
      const res = await uploadAPI.addressUpdateProof(formData);
      setUploadedProofUrl(res.data.proofUrl);
      setProofFile({ name: asset.name || `proof.${ext}` });
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar o comprovante. Tente novamente.');
    } finally {
      setUploadingProof(false);
    }
  };

  const submitAddressUpdate = async () => {
    if (!addressForm.street || !addressForm.city || !addressForm.state || !addressForm.zipCode) {
      Alert.alert('Campos obrigatórios', 'Preencha rua, cidade, estado e CEP.');
      return;
    }
    if (!uploadedProofUrl) {
      Alert.alert('Comprovante obrigatório', 'Envie o comprovante de endereço.');
      return;
    }
    setSubmittingAddress(true);
    try {
      await userAPI.submitAddressUpdate({ newAddress: addressForm, proofUrl: uploadedProofUrl });
      Alert.alert(
        'Solicitação enviada!',
        'Seu novo endereço está em análise. O prazo é de até 24 horas.',
        [{
          text: 'OK', onPress: () => {
            setAddressUpdateEnabled(false);
            setUploadedProofUrl(null);
            setProofFile(null);
            loadAddressStatus();
          },
        }]
      );
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível enviar a solicitação.');
    } finally {
      setSubmittingAddress(false);
    }
  };

  const fmtAddress = (a) => {
    if (!a?.street) return 'Endereço não cadastrado';
    return [a.street, a.neighborhood, a.city, a.state].filter(Boolean).join(', ');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar Perfil</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* ── PROFISSÕES ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profissões</Text>
          <Text style={styles.sectionSub}>Selecione as áreas em que deseja atuar</Text>

          {loadingTypes ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : serviceTypes.length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma profissão disponível no momento.</Text>
          ) : (
            <>
              <View style={styles.chipsGrid}>
                {serviceTypes.map((st) => {
                  const selected = selectedSlugs.includes(st.slug);
                  return (
                    <TouchableOpacity
                      key={st.slug}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => toggleSlug(st.slug)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {st.name}
                      </Text>
                      {selected && (
                        <Ionicons name="checkmark-circle" size={14} color={colors.primary} style={{ marginLeft: 5 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, (savingProfessions || selectedSlugs.length === 0) && styles.btnDisabled]}
                onPress={saveProfessions}
                disabled={savingProfessions || selectedSlugs.length === 0}
                activeOpacity={0.8}
              >
                {savingProfessions
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>Salvar profissões</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── ENDEREÇO ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Endereço Profissional</Text>

          {/* Current address display */}
          <View style={styles.currentAddressCard}>
            <Ionicons name="location-outline" size={18} color={colors.secondary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.currentAddressLabel}>Endereço atual</Text>
              <Text style={styles.currentAddressValue}>{fmtAddress(user.professionalAddress)}</Text>
              {user.professionalAddress?.complement ? (
                <Text style={styles.currentAddressComplement}>
                  Complemento: {user.professionalAddress.complement}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Pending or form */}
          {checkingPending ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 14 }} />
          ) : pendingRequest ? (
            <View style={styles.pendingCard}>
              <Ionicons name="time-outline" size={22} color={colors.warning} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.pendingTitle}>Atualização em análise</Text>
                <Text style={styles.pendingText}>
                  Seu novo endereço está sendo revisado. O prazo é de até 24 horas. Você
                  poderá enviar uma nova solicitação após a conclusão desta análise.
                </Text>
              </View>
            </View>
          ) : (
            <>
              {/* Toggle switch */}
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setAddressUpdateEnabled((v) => !v)}
                activeOpacity={0.7}
              >
                <View style={styles.toggleInfo}>
                  <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.toggleLabel}>Quero atualizar meu endereço</Text>
                </View>
                <View style={[styles.toggleTrack, addressUpdateEnabled && styles.toggleTrackOn]}>
                  <View style={[styles.toggleThumb, addressUpdateEnabled && styles.toggleThumbOn]} />
                </View>
              </TouchableOpacity>

              {addressUpdateEnabled && (
                <View style={styles.addressForm}>

                  {/* CEP + lookup */}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>CEP *</Text>
                      <TextInput
                        style={styles.input}
                        value={addressForm.zipCode}
                        onChangeText={(v) => setAddressForm((p) => ({ ...p, zipCode: v }))}
                        placeholder="00000-000"
                        keyboardType="numeric"
                        maxLength={9}
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.cepBtn}
                      onPress={lookupCep}
                      disabled={lookingUpCep}
                      activeOpacity={0.8}
                    >
                      {lookingUpCep
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={styles.cepBtnText}>Buscar</Text>
                      }
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.fieldLabel}>Rua / Logradouro *</Text>
                  <TextInput
                    style={styles.input}
                    value={addressForm.street}
                    onChangeText={(v) => setAddressForm((p) => ({ ...p, street: v }))}
                    placeholder="Ex: Rua das Flores, 42"
                  />

                  <Text style={styles.fieldLabel}>Bairro</Text>
                  <TextInput
                    style={styles.input}
                    value={addressForm.neighborhood}
                    onChangeText={(v) => setAddressForm((p) => ({ ...p, neighborhood: v }))}
                    placeholder="Bairro"
                  />

                  <View style={styles.row}>
                    <View style={{ flex: 2, marginRight: 8 }}>
                      <Text style={styles.fieldLabel}>Cidade *</Text>
                      <TextInput
                        style={styles.input}
                        value={addressForm.city}
                        onChangeText={(v) => setAddressForm((p) => ({ ...p, city: v }))}
                        placeholder="Cidade"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Estado *</Text>
                      <TextInput
                        style={styles.input}
                        value={addressForm.state}
                        onChangeText={(v) => setAddressForm((p) => ({ ...p, state: v.toUpperCase() }))}
                        placeholder="UF"
                        maxLength={2}
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>Complemento</Text>
                  <TextInput
                    style={styles.input}
                    value={addressForm.complement}
                    onChangeText={(v) => setAddressForm((p) => ({ ...p, complement: v }))}
                    placeholder="Apto, bloco, casa (opcional)"
                  />

                  {/* Proof upload */}
                  <Text style={styles.fieldLabel}>Comprovante de endereço *</Text>
                  <TouchableOpacity
                    style={[styles.proofBtn, uploadedProofUrl && styles.proofBtnDone]}
                    onPress={pickProof}
                    disabled={uploadingProof}
                    activeOpacity={0.8}
                  >
                    {uploadingProof ? (
                      <ActivityIndicator color={uploadedProofUrl ? colors.success : colors.primary} />
                    ) : (
                      <>
                        <Ionicons
                          name={uploadedProofUrl ? 'checkmark-circle' : 'cloud-upload-outline'}
                          size={20}
                          color={uploadedProofUrl ? colors.success : colors.primary}
                        />
                        <Text style={[styles.proofBtnText, uploadedProofUrl && styles.proofBtnTextDone]}>
                          {uploadedProofUrl
                            ? `Enviado: ${proofFile?.name || 'comprovante'}`
                            : 'Anexar comprovante (imagem ou PDF)'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <Text style={styles.proofHint}>
                    Conta de água, luz, gás, internet ou extrato bancário dos últimos 3 meses.
                  </Text>

                  {/* Submit button */}
                  <TouchableOpacity
                    style={[styles.secondaryBtn, submittingAddress && styles.btnDisabled]}
                    onPress={submitAddressUpdate}
                    disabled={submittingAddress}
                    activeOpacity={0.8}
                  >
                    {submittingAddress ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="send-outline" size={18} color="#fff" />
                        <Text style={styles.secondaryBtnText}>Enviar para análise</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  content: { padding: 16 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  emptyText: { fontSize: typography.fontSizes.sm, color: colors.textLight, textAlign: 'center', paddingVertical: 12 },

  // Chips
  chipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.background,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}10` },
  chipText: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: colors.primary, fontWeight: '700' },

  // Buttons
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: typography.fontSizes.md },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.secondary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryBtnText: { color: '#fff', fontWeight: '700', fontSize: typography.fontSizes.md },
  btnDisabled: { opacity: 0.5 },

  // Current address
  currentAddressCard: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  currentAddressLabel: {
    fontSize: 11,
    color: colors.textLight,
    fontWeight: '600',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  currentAddressValue: {
    fontSize: typography.fontSizes.sm,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  currentAddressComplement: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // Pending card
  pendingCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    alignItems: 'flex-start',
    marginTop: 4,
  },
  pendingTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: '#7B6000',
    marginBottom: 4,
  },
  pendingText: { fontSize: 12, color: '#7B6000', lineHeight: 18 },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  toggleInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '500' },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    justifyContent: 'center',
    padding: 3,
  },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },

  // Address form
  addressForm: { marginTop: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  fieldLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: typography.fontSizes.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  cepBtn: {
    backgroundColor: colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  cepBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Proof
  proofBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: `${colors.primary}08`,
  },
  proofBtnDone: { borderColor: colors.success, backgroundColor: `${colors.success}08`, borderStyle: 'solid' },
  proofBtnText: { flex: 1, color: colors.primary, fontWeight: '600', fontSize: typography.fontSizes.sm },
  proofBtnTextDone: { color: colors.success },
  proofHint: { fontSize: 11, color: colors.textLight, marginTop: -4 },
});
