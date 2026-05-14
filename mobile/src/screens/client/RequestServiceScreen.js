import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, StatusBar, ActivityIndicator, Alert, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const TIME_OPTIONS = ['07:00', '08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

function getDateLabel(date) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(date); target.setHours(0,0,0,0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  return target.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

function formatDurationMin(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return String(minutes);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${rem}min`;
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export default function RequestServiceScreen({ navigation, route }) {
  const serviceType = route?.params?.serviceType || null;
  const priceTiers = Array.isArray(serviceType?.priceTiers) ? serviceType.priceTiers : [];
  const upsellOptions = Array.isArray(serviceType?.upsells) ? serviceType.upsells : [];

  const [step, setStep] = useState(1);
  const [selectedTier, setSelectedTier] = useState(priceTiers[0] || null);
  const [selectedUpsellKeys, setSelectedUpsellKeys] = useState([]);
  const [notes, setNotes] = useState('');
  const [scheduleMode, setScheduleMode] = useState('now');
  const [scheduledDate, setScheduledDate] = useState(getTomorrow());
  const [selectedTime, setSelectedTime] = useState('08:00');
  const [address, setAddress] = useState({
    street: '', neighborhood: '', city: '', state: '', zipCode: '', complement: '',
    coordinates: [0, 0],
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [coverageNotice, setCoverageNotice] = useState('');
  const [checkingCoverage, setCheckingCoverage] = useState(false);

  function buildScheduledDate(dateISO, timeStr) {
    const d = new Date(dateISO);
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  function shiftDate(dateISO, days) {
    const d = new Date(dateISO);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  const getFinalScheduledDate = () => {
    if (scheduleMode === 'now') {
      const d = new Date(); d.setMinutes(d.getMinutes() + 5);
      return d.toISOString();
    }
    return buildScheduledDate(scheduledDate, selectedTime);
  };

  const toggleUpsell = (key) => {
    setSelectedUpsellKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const fetchEstimate = useCallback(async () => {
    if (!selectedTier || !serviceType?.slug) return;
    setLoadingEstimate(true);
    try {
      const { data } = await requestAPI.estimate(
        serviceType.slug,
        selectedTier.label,
        selectedUpsellKeys,
      );
      setEstimate(data);
    } catch {
      // ignora erro de estimativa
    } finally {
      setLoadingEstimate(false);
    }
  }, [selectedTier?.label, selectedUpsellKeys.join(','), serviceType?.slug]);

  useEffect(() => {
    fetchEstimate();
  }, [fetchEstimate]);

  useEffect(() => {
    if (coverageNotice) setCoverageNotice('');
  }, [address.city, address.state]);

  const fetchViaCep = async (rawCep) => {
    const cep = rawCep.replace(/\D/g, '');
    if (cep.length !== 8) { setCepError(''); return; }
    setCepLoading(true); setCepError('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (data.erro) { setCepError('CEP não encontrado.'); return; }
      setAddress(prev => ({
        ...prev,
        street: data.logradouro || prev.street,
        neighborhood: data.bairro || prev.neighborhood,
        city: data.localidade || prev.city,
        state: data.uf || prev.state,
      }));
    } catch {
      setCepError('Não foi possível consultar o CEP. Verifique sua conexão.');
    } finally {
      setCepLoading(false);
    }
  };

  const getCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão negada', 'Ative a localização para preenchimento automático.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setAddress(prev => ({
        ...prev,
        street: `${geo.street || ''} ${geo.streetNumber || ''}`.trim(),
        neighborhood: geo.district || geo.subregion || '',
        city: geo.city || geo.subregion || geo.region || '',
        state: geo.region || '',
        zipCode: geo.postalCode || '',
        coordinates: [loc.coords.longitude, loc.coords.latitude],
      }));
    } catch {
      Alert.alert('Erro', 'Não foi possível obter a localização.');
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleContinue = () => {
    if (step === 1 && !selectedTier) {
      Alert.alert('Atenção', 'Selecione uma faixa de serviço.'); return;
    }
    setStep(step + 1);
  };

  const handleSubmit = () => {
    if (!address.street || !address.city) {
      Alert.alert('Atenção', 'Preencha o endereço do serviço.'); return;
    }
    setCheckingCoverage(true);
    requestAPI.checkCoverage(address.city, address.state)
      .then(({ data }) => {
        if (!data.covered) {
          const message = data.message || 'No momento a solicitação não está disponível na sua cidade.';
          setCoverageNotice(message);
          Alert.alert('Serviço indisponível', message);
          return;
        }

        const geocodeAddressText = [address.street, address.neighborhood, address.city, address.state, address.zipCode, 'Brasil']
          .map(s => String(s || '').trim()).filter(Boolean).join(', ');

        const finalizeNavigation = (coords = null) => {
          const requestAddress = { ...address, coordinates: coords || address.coordinates };
          const requestData = {
            serviceTypeSlug: serviceType?.slug,
            tierLabel: selectedTier.label,
            selectedUpsells: selectedUpsellKeys,
            notes,
            address: requestAddress,
            scheduledDate: getFinalScheduledDate(),
          };
          navigation.navigate('Payment', { requestData, estimate, serviceType });
        };

        Location.geocodeAsync(geocodeAddressText)
          .then(results => {
            const first = Array.isArray(results) && results.length ? results[0] : null;
            if (first && Number.isFinite(first.longitude) && Number.isFinite(first.latitude)) {
              finalizeNavigation([first.longitude, first.latitude]);
            } else {
              finalizeNavigation();
            }
          })
          .catch(() => finalizeNavigation());
      })
      .catch(err => {
        const message = err?.response?.data?.message || 'Não foi possível validar sua cidade no momento.';
        Alert.alert('Erro', message);
      })
      .finally(() => setCheckingCoverage(false));
  };

  const selectedUpsells = upsellOptions.filter(u => selectedUpsellKeys.includes(u.key));
  const upsellsTotal = selectedUpsells.reduce((sum, u) => sum + Number(u.price), 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contratar {serviceType?.name || 'Serviço'}</Text>
          <View style={{ width: 38 }} />
        </LinearGradient>

        <View style={styles.stepsBar}>
          {['Detalhes', 'Endereço', 'Confirmar'].map((label, idx) => {
            const s = idx + 1;
            return (
              <React.Fragment key={s}>
                <View style={styles.stepWrap}>
                  <View style={[styles.stepDot, step >= s && styles.stepDotActive]}>
                    {step > s
                      ? <Ionicons name="checkmark" size={14} color={colors.white} />
                      : <Text style={[styles.stepDotText, step >= s && styles.stepDotTextActive]}>{s}</Text>}
                  </View>
                  <Text style={[styles.stepLabel, step >= s && styles.stepLabelActive]}>{label}</Text>
                </View>
                {s < 3 && <View style={[styles.stepLine, step > s && styles.stepLineActive]} />}
              </React.Fragment>
            );
          })}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.sectionTitle}>Detalhes do serviço</Text>

              <Text style={styles.label}>Escolha a faixa de serviço</Text>
              {priceTiers.length === 0 ? (
                <View style={styles.warningBox}>
                  <Ionicons name="warning-outline" size={18} color={colors.warning} />
                  <Text style={styles.warningText}>Nenhuma faixa configurada para este serviço.</Text>
                </View>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {priceTiers.map(tier => {
                    const active = selectedTier?.label === tier.label;
                    return (
                      <TouchableOpacity
                        key={tier.label}
                        style={[styles.tierCard, active && styles.tierCardActive]}
                        onPress={() => setSelectedTier(tier)}
                        activeOpacity={0.8}
                      >
                        {active && (
                          <LinearGradient colors={colors.gradientPrimary} style={StyleSheet.absoluteFill} />
                        )}
                        <View style={styles.tierCardContent}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>{tier.label}</Text>
                            <Text style={[styles.tierDuration, active && styles.tierDurationActive]}>
                              {formatDurationMin(tier.durationMinutes)}
                            </Text>
                          </View>
                          <Text style={[styles.tierPrice, active && styles.tierPriceActive]}>
                            R$ {Number(tier.price).toFixed(0)}
                          </Text>
                          {active && (
                            <View style={styles.tierCheck}>
                              <Ionicons name="checkmark-circle" size={22} color={colors.white} />
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {upsellOptions.length > 0 && (
                <>
                  <Text style={styles.label}>Opcionais</Text>
                  <View style={{ gap: 8 }}>
                    {upsellOptions.map(upsell => {
                      const active = selectedUpsellKeys.includes(upsell.key);
                      return (
                        <TouchableOpacity
                          key={upsell.key}
                          style={[styles.checkRow, active && styles.checkRowActive]}
                          onPress={() => toggleUpsell(upsell.key)}
                          activeOpacity={0.8}
                        >
                          <View style={[styles.checkbox, active && styles.checkboxActive]}>
                            {active && <Ionicons name="checkmark" size={14} color={colors.white} />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.checkLabel}>{upsell.label}</Text>
                          </View>
                          <Text style={[styles.upsellPrice, active && { color: colors.primary }]}>
                            +R$ {Number(upsell.price).toFixed(0)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={styles.label}>Observações (opcional)</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Ex: Tem animais, foco na cozinha..."
                placeholderTextColor={colors.textLight}
                multiline
                numberOfLines={3}
                value={notes}
                onChangeText={setNotes}
              />

              {selectedTier && (
                <LinearGradient colors={['#FFF8F5', '#FFF0E6']} style={styles.estimateCard}>
                  <Text style={styles.estimateLabel}>Estimativa</Text>
                  {loadingEstimate
                    ? <ActivityIndicator color={colors.primary} />
                    : (
                      <>
                        <Text style={styles.estimateValue}>
                          R$ {estimate
                            ? Number(estimate.estimated).toFixed(2)
                            : (Number(selectedTier.price) + upsellsTotal).toFixed(2)}
                        </Text>
                        <Text style={styles.estimateDetail}>
                          {selectedTier.label}{selectedUpsells.length > 0 && ` + ${selectedUpsells.length} opcional(is)`}
                        </Text>
                      </>
                    )}
                </LinearGradient>
              )}

              <Text style={styles.label}>Quando você precisa?</Text>
              <View style={styles.scheduleToggleRow}>
                {[
                  { mode: 'now', icon: 'flash', iconOff: 'flash-outline', label: 'Agora' },
                  { mode: 'later', icon: 'calendar', iconOff: 'calendar-outline', label: 'Agendar' },
                ].map(({ mode, icon, iconOff, label }) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.scheduleToggleBtn, scheduleMode === mode && styles.scheduleToggleBtnActive]}
                    onPress={() => setScheduleMode(mode)}
                    activeOpacity={0.8}
                  >
                    {scheduleMode === mode
                      ? <LinearGradient colors={colors.gradientPrimary} style={styles.scheduleToggleGrad}>
                          <Ionicons name={icon} size={16} color={colors.white} />
                          <Text style={styles.scheduleToggleTextActive}>{label}</Text>
                        </LinearGradient>
                      : <View style={styles.scheduleToggleGrad}>
                          <Ionicons name={iconOff} size={16} color={colors.textSecondary} />
                          <Text style={styles.scheduleToggleText}>{label}</Text>
                        </View>}
                  </TouchableOpacity>
                ))}
              </View>

              {scheduleMode === 'later' && (
                <View style={styles.schedulePicker}>
                  <View style={styles.datePicker}>
                    <TouchableOpacity
                      style={styles.dateArrow}
                      onPress={() => {
                        const prev = shiftDate(scheduledDate, -1);
                        const today = new Date(); today.setHours(0,0,0,0);
                        if (new Date(prev) >= today) setScheduledDate(prev);
                      }}
                    >
                      <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <Text style={styles.dateLabel}>{getDateLabel(scheduledDate)}</Text>
                    <TouchableOpacity style={styles.dateArrow} onPress={() => setScheduledDate(shiftDate(scheduledDate, 1))}>
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.timeGrid}>
                    {TIME_OPTIONS.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.timeBtn, selectedTime === t && styles.timeBtnActive]}
                        onPress={() => setSelectedTime(t)}
                        activeOpacity={0.8}
                      >
                        {selectedTime === t
                          ? <LinearGradient colors={colors.gradientPrimary} style={styles.timeBtnGrad}>
                              <Text style={styles.timeBtnTextActive}>{t}</Text>
                            </LinearGradient>
                          : <Text style={styles.timeBtnText}>{t}</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.sectionTitle}>Endereço do serviço</Text>

              <TouchableOpacity style={styles.locationBtn} onPress={getCurrentLocation} disabled={loadingLocation} activeOpacity={0.85}>
                <LinearGradient colors={colors.gradientSecondary} style={styles.locationBtnGrad}>
                  {loadingLocation
                    ? <ActivityIndicator color={colors.white} size="small" />
                    : <Ionicons name="locate" size={18} color={colors.white} />}
                  <Text style={styles.locationBtnText}>Usar localização atual</Text>
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>CEP</Text>
                <View style={styles.cepRow}>
                  <TextInput
                    style={[styles.inputField, styles.cepInput]}
                    placeholder="00000-000"
                    placeholderTextColor={colors.textLight}
                    keyboardType="numeric"
                    maxLength={9}
                    value={address.zipCode}
                    onChangeText={v => { setAddress(prev => ({ ...prev, zipCode: v })); fetchViaCep(v); }}
                  />
                  {cepLoading && <ActivityIndicator size="small" color={colors.primary} style={styles.cepSpinner} />}
                </View>
                {!!cepError && <Text style={styles.cepErrorText}>{cepError}</Text>}
              </View>

              {[
                { label: 'Rua / Logradouro', key: 'street', placeholder: 'Rua das Flores, 123' },
                { label: 'Bairro', key: 'neighborhood', placeholder: 'Centro' },
                { label: 'Cidade', key: 'city', placeholder: 'São Paulo' },
                { label: 'Estado', key: 'state', placeholder: 'SP' },
                { label: 'Complemento', key: 'complement', placeholder: 'Apto 42, Bloco B' },
              ].map(field => (
                <View key={field.key} style={styles.inputGroup}>
                  <Text style={styles.label}>{field.label}</Text>
                  <TextInput
                    style={styles.inputField}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.textLight}
                    value={address[field.key]}
                    onChangeText={v => setAddress(prev => ({ ...prev, [field.key]: v }))}
                  />
                </View>
              ))}

              {!!coverageNotice && (
                <View style={styles.coverageWarning}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.coverageWarningText}>{coverageNotice}</Text>
                </View>
              )}
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.sectionTitle}>Confirmar pedido</Text>

              <View style={styles.confirmCard}>
                {[
                  { icon: 'pricetag-outline', label: 'Faixa', value: selectedTier?.label || '-' },
                  { icon: 'time-outline', label: 'Duração', value: formatDurationMin(selectedTier?.durationMinutes) },
                  ...(selectedUpsells.length > 0 ? [{ icon: 'add-circle-outline', label: 'Opcionais', value: selectedUpsells.map(u => u.label).join(', ') }] : []),
                  { icon: 'location-outline', label: 'Endereço', value: `${address.street}, ${address.city}` },
                  { icon: 'calendar-outline', label: 'Data', value: scheduleMode === 'now' ? 'Agora (imediato)' : `${getDateLabel(scheduledDate)} às ${selectedTime}` },
                  ...(notes ? [{ icon: 'chatbubble-outline', label: 'Obs.', value: notes }] : []),
                ].map((row, i, arr) => (
                  <View key={i} style={[styles.confirmRow, i < arr.length - 1 && styles.confirmRowBorder]}>
                    <View style={styles.confirmIcon}>
                      <Ionicons name={row.icon} size={16} color={colors.primary} />
                    </View>
                    <Text style={styles.confirmLabel}>{row.label}</Text>
                    <Text style={styles.confirmValue}>{row.value}</Text>
                  </View>
                ))}
              </View>

              <LinearGradient colors={['#F0FFF4', '#E8F5E9']} style={styles.totalCard}>
                <Text style={styles.totalLabel}>Total a pagar</Text>
                <Text style={styles.totalValue}>
                  R$ {estimate
                    ? Number(estimate.estimated).toFixed(2)
                    : (Number(selectedTier?.price || 0) + upsellsTotal).toFixed(2)}
                </Text>
                <View style={styles.totalDetail}>
                  <Ionicons name="lock-closed" size={12} color={colors.success} />
                  <Text style={styles.totalDetailText}>Pagamento seguro via app</Text>
                </View>
              </LinearGradient>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 && (
            <TouchableOpacity style={styles.btnBack} onPress={() => setStep(step - 1)}>
              <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
              <Text style={styles.btnBackText}>Voltar</Text>
            </TouchableOpacity>
          )}
          {step < 3 ? (
            <TouchableOpacity style={[styles.btnNextWrap, step === 1 && { flex: 1 }]} onPress={handleContinue} activeOpacity={0.85}>
              <LinearGradient colors={colors.gradientPrimary} style={styles.btnNext}>
                <Text style={styles.btnNextText}>Continuar</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.white} />
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btnNextWrap} onPress={handleSubmit} disabled={checkingCoverage} activeOpacity={0.85}>
              <LinearGradient colors={colors.gradientPrimary} style={styles.btnNext}>
                {checkingCoverage
                  ? <ActivityIndicator color={colors.white} />
                  : <Ionicons name="lock-closed" size={18} color={colors.white} />}
                <Text style={styles.btnNextText}>{checkingCoverage ? 'Validando...' : 'Ir para Pagamento'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 55, paddingBottom: 16, paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.white },
  stepsBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  stepWrap: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDotText: { fontSize: 12, fontWeight: '700', color: colors.textLight },
  stepDotTextActive: { color: colors.white },
  stepLabel: { fontSize: 10, color: colors.textLight, fontWeight: '500' },
  stepLabelActive: { color: colors.primary, fontWeight: '700' },
  stepLine: { width: 32, height: 2, backgroundColor: colors.border, marginBottom: 14, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 30 },
  stepContent: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  label: { fontSize: typography.fontSizes.sm, fontWeight: '600', color: colors.textPrimary, marginBottom: 8, marginTop: 12 },
  tierCard: {
    borderRadius: borderRadius.xl, borderWidth: 1.5, borderColor: colors.border,
    overflow: 'hidden',
  },
  tierCardActive: { borderColor: colors.primary },
  tierCardContent: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  tierLabel: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  tierLabelActive: { color: colors.white },
  tierDuration: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 2 },
  tierDurationActive: { color: 'rgba(255,255,255,0.8)' },
  tierPrice: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.primary },
  tierPriceActive: { color: colors.white },
  tierCheck: { marginLeft: 4 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    padding: spacing.md, borderWidth: 1.5, borderColor: 'transparent',
  },
  checkRowActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}05` },
  checkbox: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: { fontSize: typography.fontSizes.md, color: colors.textPrimary, fontWeight: '600' },
  upsellPrice: { fontSize: typography.fontSizes.sm, color: colors.textLight, fontWeight: '600' },
  warningBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF6E8', borderWidth: 1, borderColor: '#F5C16C',
    borderRadius: borderRadius.lg, padding: spacing.md,
  },
  warningText: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary },
  textArea: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, fontSize: typography.fontSizes.md, color: colors.textPrimary,
    textAlignVertical: 'top', minHeight: 80,
  },
  estimateCard: {
    borderRadius: borderRadius.xl, padding: spacing.lg, alignItems: 'center',
    marginTop: 4, borderWidth: 1.5, borderColor: `${colors.primary}30`,
  },
  estimateLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '500' },
  estimateValue: { fontSize: 36, fontWeight: '800', color: colors.primary, lineHeight: 44 },
  estimateDetail: { fontSize: typography.fontSizes.sm, color: colors.textLight },
  scheduleToggleRow: { flexDirection: 'row', gap: spacing.sm },
  scheduleToggleBtn: {
    flex: 1, borderRadius: borderRadius.full,
    borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden',
  },
  scheduleToggleBtnActive: { borderColor: colors.primary },
  scheduleToggleGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  scheduleToggleText: { fontSize: typography.fontSizes.md, color: colors.textSecondary, fontWeight: '600' },
  scheduleToggleTextActive: { fontSize: typography.fontSizes.md, color: colors.white, fontWeight: '700' },
  schedulePicker: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, marginTop: 8,
  },
  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, marginBottom: spacing.sm,
  },
  dateArrow: { padding: 8 },
  dateLabel: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  timeBtn: { borderRadius: borderRadius.md, borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden', minWidth: 70 },
  timeBtnActive: { borderColor: colors.primary },
  timeBtnGrad: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  timeBtnText: {
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '600', textAlign: 'center',
  },
  timeBtnTextActive: { fontSize: typography.fontSizes.sm, color: colors.white, fontWeight: '700' },
  locationBtn: { borderRadius: borderRadius.full, overflow: 'hidden', marginBottom: 4 },
  locationBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: 14,
  },
  locationBtnText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.md },
  inputGroup: {},
  cepRow: { flexDirection: 'row', alignItems: 'center' },
  cepInput: { flex: 1 },
  cepSpinner: { position: 'absolute', right: 14 },
  cepErrorText: { fontSize: typography.fontSizes.xs, color: colors.error, marginTop: 4, marginLeft: 4 },
  inputField: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, fontSize: typography.fontSizes.md, color: colors.textPrimary,
  },
  coverageWarning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFF6E8', borderWidth: 1, borderColor: '#F5C16C',
    borderRadius: borderRadius.lg, padding: spacing.md, marginTop: 10,
  },
  coverageWarningText: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, lineHeight: 20 },
  confirmCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, paddingHorizontal: spacing.lg },
  confirmRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: spacing.sm },
  confirmRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  confirmIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, width: 70 },
  confirmValue: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '600' },
  totalCard: {
    borderRadius: borderRadius.xl, padding: spacing.xl, alignItems: 'center',
    marginTop: spacing.md, borderWidth: 1.5, borderColor: `${colors.success}40`,
  },
  totalLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  totalValue: { fontSize: 42, fontWeight: '800', color: colors.success, lineHeight: 54 },
  totalDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  totalDetailText: { fontSize: typography.fontSizes.sm, color: colors.success, fontWeight: '500' },
  footer: {
    flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.white,
  },
  btnBack: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.lg, paddingVertical: 16,
    borderRadius: borderRadius.full, borderWidth: 1.5, borderColor: colors.border,
  },
  btnBackText: { color: colors.textSecondary, fontWeight: '600', fontSize: typography.fontSizes.md },
  btnNextWrap: { flex: 1, borderRadius: borderRadius.full, overflow: 'hidden' },
  btnNext: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: 17,
  },
  btnNextText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.lg },
});
