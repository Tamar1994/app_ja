import React, { useState, useEffect } from 'react';
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

const DEFAULT_HOURS_OPTIONS = [2, 3, 4, 5, 6, 8];
const TIME_OPTIONS = ['07:00', '08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

function getDateLabel(date) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(date); target.setHours(0,0,0,0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  return target.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

function buildInitialCustomFormData(fields = []) {
  const initial = {};
  (fields || []).forEach((field) => {
    if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
      initial[field.key] = field.defaultValue;
      return;
    }
    if (field.inputType === 'boolean') initial[field.key] = false;
    if (field.inputType === 'number') initial[field.key] = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
    if (field.inputType === 'text') initial[field.key] = '';
    if (field.inputType === 'select') {
      const first = Array.isArray(field.options) && field.options.length ? field.options[0].value : '';
      initial[field.key] = first || '';
    }
  });
  return initial;
}

function formatCustomFieldValue(field, value) {
  if (field.inputType === 'boolean') return value ? 'Sim' : 'Não';
  if (field.inputType === 'select') {
    const option = (field.options || []).find((opt) => String(opt.value) === String(value));
    return option?.label || '-';
  }
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

export default function RequestServiceScreen({ navigation, route }) {
  const serviceType = route?.params?.serviceType || null;
  const hoursOptions = Array.isArray(serviceType?.hoursOptions) && serviceType.hoursOptions.length
    ? [...new Set(serviceType.hoursOptions.map((h) => Number(h)).filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => a - b)
    : DEFAULT_HOURS_OPTIONS;
  const checkoutFields = Array.isArray(serviceType?.checkoutFields)
    ? [...serviceType.checkoutFields].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    : [];
  const hasDynamicFields = checkoutFields.length > 0;
  const supportsProducts = !serviceType?.slug || serviceType.slug === 'diarista';
  const [step, setStep] = useState(1); // 1: detalhes, 2: endereço, 3: confirmação
  const [hours, setHours] = useState(hoursOptions[0] || 2);
  const [rooms, setRooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);
  const [hasProducts, setHasProducts] = useState(false);
  const [customFormData, setCustomFormData] = useState(() => buildInitialCustomFormData(checkoutFields));
  const [notes, setNotes] = useState('');
  const [scheduleMode, setScheduleMode] = useState('now'); // 'now' | 'later'
  const [scheduledDate, setScheduledDate] = useState(getTomorrow());
  const [selectedTime, setSelectedTime] = useState('08:00');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [address, setAddress] = useState({
    street: '', neighborhood: '', city: '', state: '', zipCode: '', complement: '',
    coordinates: [0, 0],
  });
  const [estimate, setEstimate] = useState(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [timeWindows, setTimeWindows] = useState(serviceType?.timeWindows || []);
  const [pricePerMinute, setPricePerMinute] = useState(serviceType?.pricePerMinute || 0);

  function getTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.toISOString();
  }

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
      const d = new Date();
      d.setMinutes(d.getMinutes() + 5);
      return d.toISOString();
    }
    return buildScheduledDate(scheduledDate, selectedTime);
  };

  useEffect(() => {
    setCustomFormData(buildInitialCustomFormData(checkoutFields));
  }, [serviceType?.slug]);

  useEffect(() => {
    if (!hoursOptions.length) return;
    if (!hoursOptions.includes(hours)) {
      setHours(hoursOptions[0]);
    }
  }, [serviceType?.slug, hoursOptions.join(','), hours]);

  useEffect(() => {
    fetchEstimate();
  }, [hours, hasProducts, JSON.stringify(customFormData), serviceType?.slug]);

  const fetchEstimate = async () => {
    setLoadingEstimate(true);
    try {
      const { data } = await requestAPI.estimate(
        hours,
        supportsProducts ? hasProducts : true,
        serviceType?.slug || null,
        customFormData
      );
      setEstimate(data);
    } catch {
      // ignora erro de estimativa
    } finally {
      setLoadingEstimate(false);
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
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setAddress((prev) => ({
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

  const handleSubmit = () => {
    if (!address.street || !address.city) {
      Alert.alert('Atenção', 'Preencha o endereço do serviço.');
      return;
    }
    const requestData = {
      hours, rooms, bathrooms, hasProducts: supportsProducts ? hasProducts : true, notes,
      address, scheduledDate: getFinalScheduledDate(),
      serviceTypeSlug: serviceType?.slug || null,
      customFormData,
    };
    navigation.navigate('Payment', { requestData, estimate, serviceType });
  };

  const handleContinue = () => {
    if (step === 1 && hasDynamicFields) {
      const missing = checkoutFields.find((field) => {
        if (!field.required) return false;
        const value = customFormData[field.key];
        if (field.inputType === 'boolean') return !value;
        return value === undefined || value === null || value === '';
      });
      if (missing) {
        Alert.alert('Campo obrigatório', `Preencha: ${missing.label}`);
        return;
      }
    }
    setStep(step + 1);
  };

  const updateCustomField = (field, rawValue) => {
    let value = rawValue;
    if (field.inputType === 'number') {
      const num = Number(rawValue);
      value = Number.isFinite(num) ? num : 0;
      if (Number.isFinite(Number(field.min))) value = Math.max(Number(field.min), value);
      if (Number.isFinite(Number(field.max))) value = Math.min(Number(field.max), value);
    }

    setCustomFormData((prev) => ({ ...prev, [field.key]: value }));
  };

  function calculatePrice(duration) {
    return (pricePerMinute * duration).toFixed(2);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
    >
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header gradiente */}
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contratar {serviceType?.name || 'Diarista'}</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {/* Steps indicator */}
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
              {s < 3 && (
                <View style={[styles.stepLine, step > s && styles.stepLineActive]} />
              )}
            </React.Fragment>
          );
        })}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* PASSO 1 */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.sectionTitle}>Detalhes do serviço</Text>

            <Text style={styles.label}>Duração da limpeza</Text>
            <View style={styles.optionsRow}>
              {hoursOptions.map((h) => (
                <TouchableOpacity
                  key={h}
                  style={[styles.optionBtn, hours === h && styles.optionBtnActive]}
                  onPress={() => setHours(h)}
                  activeOpacity={0.8}
                >
                  {hours === h
                    ? (
                      <LinearGradient colors={colors.gradientPrimary} style={styles.optionBtnGrad}>
                        <Text style={styles.optionTextActive}>{h}h</Text>
                      </LinearGradient>
                    )
                    : <Text style={styles.optionText}>{h}h</Text>}
                </TouchableOpacity>
              ))}
            </View>

            {!hasDynamicFields && (
              <View style={styles.countersRow}>
                <View style={styles.counterCard}>
                  <Text style={styles.counterLabel}>Cômodos</Text>
                  <View style={styles.counter}>
                    <TouchableOpacity onPress={() => setRooms(Math.max(1, rooms - 1))} style={styles.counterBtn}>
                      <Ionicons name="remove" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    <Text style={styles.counterVal}>{rooms}</Text>
                    <TouchableOpacity onPress={() => setRooms(rooms + 1)} style={styles.counterBtn}>
                      <Ionicons name="add" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.counterCard}>
                  <Text style={styles.counterLabel}>Banheiros</Text>
                  <View style={styles.counter}>
                    <TouchableOpacity onPress={() => setBathrooms(Math.max(1, bathrooms - 1))} style={styles.counterBtn}>
                      <Ionicons name="remove" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    <Text style={styles.counterVal}>{bathrooms}</Text>
                    <TouchableOpacity onPress={() => setBathrooms(bathrooms + 1)} style={styles.counterBtn}>
                      <Ionicons name="add" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {hasDynamicFields && (
              <View style={{ gap: 10 }}>
                {checkoutFields.map((field) => {
                  const value = customFormData[field.key];

                  if (field.inputType === 'boolean') {
                    return (
                      <TouchableOpacity
                        key={field.key}
                        style={[styles.checkRow, value && styles.checkRowActive]}
                        onPress={() => updateCustomField(field, !value)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.checkbox, value && styles.checkboxActive]}>
                          {value && <Ionicons name="checkmark" size={14} color={colors.white} />}
                        </View>
                        <View>
                          <Text style={styles.checkLabel}>{field.label}</Text>
                          {!!field.placeholder && <Text style={styles.checkSub}>{field.placeholder}</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  }

                  if (field.inputType === 'number') {
                    const current = Number(value || 0);
                    const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
                    const max = Number.isFinite(Number(field.max)) ? Number(field.max) : Number.MAX_SAFE_INTEGER;
                    const stepSize = Number.isFinite(Number(field.step)) ? Number(field.step) : 1;

                    return (
                      <View key={field.key} style={styles.counterCard}>
                        <Text style={styles.counterLabel}>{field.label}</Text>
                        <View style={styles.counter}>
                          <TouchableOpacity
                            onPress={() => updateCustomField(field, Math.max(min, current - stepSize))}
                            style={styles.counterBtn}
                          >
                            <Ionicons name="remove" size={18} color={colors.primary} />
                          </TouchableOpacity>
                          <Text style={styles.counterVal}>{current}</Text>
                          <TouchableOpacity
                            onPress={() => updateCustomField(field, Math.min(max, current + stepSize))}
                            style={styles.counterBtn}
                          >
                            <Ionicons name="add" size={18} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }

                  if (field.inputType === 'select') {
                    return (
                      <View key={field.key}>
                        <Text style={styles.label}>{field.label}</Text>
                        <View style={styles.optionsRow}>
                          {(field.options || []).map((opt) => {
                            const selected = String(value) === String(opt.value);
                            return (
                              <TouchableOpacity
                                key={`${field.key}-${opt.value}`}
                                style={[styles.optionBtn, selected && styles.optionBtnActive]}
                                onPress={() => updateCustomField(field, opt.value)}
                                activeOpacity={0.8}
                              >
                                {selected
                                  ? (
                                    <LinearGradient colors={colors.gradientPrimary} style={styles.optionBtnGrad}>
                                      <Text style={styles.optionTextActive}>{opt.label}</Text>
                                    </LinearGradient>
                                  )
                                  : <Text style={styles.optionText}>{opt.label}</Text>}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    );
                  }

                  return (
                    <View key={field.key} style={styles.inputGroup}>
                      <Text style={styles.label}>{field.label}</Text>
                      <TextInput
                        style={styles.inputField}
                        placeholder={field.placeholder || ''}
                        placeholderTextColor={colors.textLight}
                        value={value ? String(value) : ''}
                        onChangeText={(text) => updateCustomField(field, text)}
                      />
                    </View>
                  );
                })}
              </View>
            )}

            {supportsProducts && (
              <TouchableOpacity
                style={[styles.checkRow, hasProducts && styles.checkRowActive]}
                onPress={() => setHasProducts(!hasProducts)}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, hasProducts && styles.checkboxActive]}>
                  {hasProducts && <Ionicons name="checkmark" size={14} color={colors.white} />}
                </View>
                <View>
                  <Text style={styles.checkLabel}>Eu forneço os produtos de limpeza</Text>
                  {!hasProducts && <Text style={styles.checkSub}>+R$5/h quando profissional traz</Text>}
                </View>
              </TouchableOpacity>
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

            {estimate && (
              <LinearGradient
                colors={['#FFF8F5', '#FFF0E6']}
                style={styles.estimateCard}
              >
                <Text style={styles.estimateLabel}>Estimativa</Text>
                {loadingEstimate
                  ? <ActivityIndicator color={colors.primary} />
                  : (
                    <>
                      <Text style={styles.estimateValue}>R$ {estimate.estimated.toFixed(2)}</Text>
                      <Text style={styles.estimateDetail}>
                        R$ {estimate.pricePerHour}/h × {hours}h
                      </Text>
                    </>
                  )}
              </LinearGradient>
            )}

            {/* Quando / Agendamento */}
            <Text style={styles.label}>Quando você precisa?</Text>
            <View style={styles.scheduleToggleRow}>
              <TouchableOpacity
                style={[styles.scheduleToggleBtn, scheduleMode === 'now' && styles.scheduleToggleBtnActive]}
                onPress={() => setScheduleMode('now')}
                activeOpacity={0.8}
              >
                {scheduleMode === 'now'
                  ? <LinearGradient colors={colors.gradientPrimary} style={styles.scheduleToggleGrad}>
                      <Ionicons name="flash" size={16} color={colors.white} />
                      <Text style={styles.scheduleToggleTextActive}>Agora</Text>
                    </LinearGradient>
                  : <View style={styles.scheduleToggleGrad}>
                      <Ionicons name="flash-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.scheduleToggleText}>Agora</Text>
                    </View>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scheduleToggleBtn, scheduleMode === 'later' && styles.scheduleToggleBtnActive]}
                onPress={() => setScheduleMode('later')}
                activeOpacity={0.8}
              >
                {scheduleMode === 'later'
                  ? <LinearGradient colors={colors.gradientPrimary} style={styles.scheduleToggleGrad}>
                      <Ionicons name="calendar" size={16} color={colors.white} />
                      <Text style={styles.scheduleToggleTextActive}>Agendar</Text>
                    </LinearGradient>
                  : <View style={styles.scheduleToggleGrad}>
                      <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.scheduleToggleText}>Agendar</Text>
                    </View>}
              </TouchableOpacity>
            </View>

            {scheduleMode === 'later' && (
              <View style={styles.schedulePicker}>
                {/* Seletor de dia */}
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
                  <TouchableOpacity
                    style={styles.dateArrow}
                    onPress={() => setScheduledDate(shiftDate(scheduledDate, 1))}
                  >
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Seletor de horário */}
                <View style={styles.timeGrid}>
                  {TIME_OPTIONS.map((t) => (
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

        {/* PASSO 2 */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.sectionTitle}>Endereço do serviço</Text>

            <TouchableOpacity
              style={styles.locationBtn}
              onPress={getCurrentLocation}
              disabled={loadingLocation}
              activeOpacity={0.85}
            >
              <LinearGradient colors={colors.gradientSecondary} style={styles.locationBtnGrad}>
                {loadingLocation
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Ionicons name="locate" size={18} color={colors.white} />}
                <Text style={styles.locationBtnText}>Usar localização atual</Text>
              </LinearGradient>
            </TouchableOpacity>

            {[
              { label: 'CEP', key: 'zipCode', keyboard: 'numeric', placeholder: '00000-000' },
              { label: 'Rua / Logradouro', key: 'street', placeholder: 'Rua das Flores, 123' },
              { label: 'Bairro', key: 'neighborhood', placeholder: 'Centro' },
              { label: 'Cidade', key: 'city', placeholder: 'São Paulo' },
              { label: 'Estado', key: 'state', placeholder: 'SP' },
              { label: 'Complemento', key: 'complement', placeholder: 'Apto 42, Bloco B' },
            ].map((field) => (
              <View key={field.key} style={styles.inputGroup}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textLight}
                  keyboardType={field.keyboard || 'default'}
                  value={address[field.key]}
                  onChangeText={(v) => setAddress((prev) => ({ ...prev, [field.key]: v }))}
                />
              </View>
            ))}
          </View>
        )}

        {/* PASSO 3 */}
        {step === 3 && estimate && (
          <View style={styles.stepContent}>
            <Text style={styles.sectionTitle}>Confirmar pedido</Text>

            <View style={styles.confirmCard}>
              {[
                { icon: 'time-outline', label: 'Duração', value: `${hours} horas` },
                ...(!hasDynamicFields ? [{ icon: 'home-outline', label: 'Cômodos', value: `${rooms} cômodo(s) · ${bathrooms} banheiro(s)` }] : []),
                ...checkoutFields.map((field) => ({
                  icon: field.inputType === 'boolean' ? 'checkbox-outline' : 'list-outline',
                  label: field.label,
                  value: formatCustomFieldValue(field, customFormData[field.key]),
                })),
                { icon: 'location-outline', label: 'Endereço', value: `${address.street}, ${address.city}` },
                { icon: 'calendar-outline', label: 'Data', value: scheduleMode === 'now' ? 'Agora (imediato)' : `${getDateLabel(scheduledDate)} às ${selectedTime}` },
                ...(supportsProducts ? [{ icon: 'cube-outline', label: 'Produtos', value: hasProducts ? 'Você fornece' : 'Profissional traz (+R$5/h)' }] : []),
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

            <LinearGradient
              colors={['#F0FFF4', '#E8F5E9']}
              style={styles.totalCard}
            >
              <Text style={styles.totalLabel}>Total a pagar</Text>
              <Text style={styles.totalValue}>R$ {estimate.estimated.toFixed(2)}</Text>
              <View style={styles.totalDetail}>
                <Ionicons name="lock-closed" size={12} color={colors.success} />
                <Text style={styles.totalDetailText}>Pagamento seguro via app</Text>
              </View>
            </LinearGradient>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {step > 1 && (
          <TouchableOpacity style={styles.btnBack} onPress={() => setStep(step - 1)}>
            <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
            <Text style={styles.btnBackText}>Voltar</Text>
          </TouchableOpacity>
        )}
        {step < 3 ? (
          <TouchableOpacity
            style={[styles.btnNextWrap, step === 1 && { flex: 1 }]}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <LinearGradient colors={colors.gradientPrimary} style={styles.btnNext}>
              <Text style={styles.btnNextText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.white} />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.btnNextWrap}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            <LinearGradient colors={colors.gradientPrimary} style={styles.btnNext}>
              <Ionicons name="lock-closed" size={18} color={colors.white} />
              <Text style={styles.btnNextText}>Ir para Pagamento</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 55,
    paddingBottom: 16,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.white },
  // Steps
  stepsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
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
  // Hour options
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionBtn: {
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionBtnActive: { borderColor: colors.primary },
  optionBtnGrad: { paddingHorizontal: 18, paddingVertical: 10 },
  optionText: {
    paddingHorizontal: 18, paddingVertical: 10,
    fontSize: typography.fontSizes.md, color: colors.textSecondary, fontWeight: '600',
  },
  optionTextActive: { fontSize: typography.fontSizes.md, color: colors.white, fontWeight: '700' },
  // Counters
  countersRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  counterCard: {
    flex: 1, backgroundColor: colors.white, borderRadius: borderRadius.xl,
    padding: spacing.md, alignItems: 'center', gap: spacing.sm, ...shadows.sm,
  },
  counterLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '600' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  counterBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1.5, borderColor: colors.primary + '50',
    backgroundColor: `${colors.primary}08`,
    alignItems: 'center', justifyContent: 'center',
  },
  counterVal: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.textPrimary, minWidth: 28, textAlign: 'center' },
  // Checkbox
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginTop: 12,
    ...shadows.sm,
  },
  checkRowActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}05` },
  checkbox: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: { fontSize: typography.fontSizes.md, color: colors.textPrimary, fontWeight: '600' },
  checkSub: { fontSize: typography.fontSizes.xs, color: colors.textLight, marginTop: 2 },
  // TextArea
  textArea: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    minHeight: 80,
    ...shadows.sm,
  },
  // Estimate
  estimateCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: `${colors.primary}30`,
  },
  estimateLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '500' },
  estimateValue: { fontSize: 36, fontWeight: '800', color: colors.primary, lineHeight: 44 },
  estimateDetail: { fontSize: typography.fontSizes.sm, color: colors.textLight },
  // Address step
  locationBtn: { borderRadius: borderRadius.full, overflow: 'hidden', marginBottom: 4 },
  locationBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: 14,
  },
  locationBtnText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.md },
  inputGroup: {},
  inputField: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    ...shadows.sm,
  },
  // Confirm
  confirmCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    ...shadows.md,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: spacing.sm,
  },
  confirmRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  confirmIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center',
  },
  confirmLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, width: 70 },
  confirmValue: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.textPrimary, fontWeight: '600' },
  totalCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: `${colors.success}40`,
  },
  totalLabel: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  totalValue: { fontSize: 42, fontWeight: '800', color: colors.success, lineHeight: 54 },
  totalDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  totalDetailText: { fontSize: typography.fontSizes.sm, color: colors.success, fontWeight: '500' },
  // Footer
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  btnBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  btnBackText: { color: colors.textSecondary, fontWeight: '600', fontSize: typography.fontSizes.md },
  btnNextWrap: { flex: 1, borderRadius: borderRadius.full, overflow: 'hidden' },
  btnNext: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: 17,
  },
  btnNextText: { color: colors.white, fontWeight: '700', fontSize: typography.fontSizes.lg },
  // Schedule
  scheduleToggleRow: { flexDirection: 'row', gap: spacing.sm },
  scheduleToggleBtn: {
    flex: 1, borderRadius: borderRadius.full,
    borderWidth: 1.5, borderColor: colors.border,
    overflow: 'hidden',
  },
  scheduleToggleBtnActive: { borderColor: colors.primary },
  scheduleToggleGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  scheduleToggleText: {
    fontSize: typography.fontSizes.md, color: colors.textSecondary, fontWeight: '600',
  },
  scheduleToggleTextActive: { fontSize: typography.fontSizes.md, color: colors.white, fontWeight: '700' },
  schedulePicker: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    padding: spacing.md, ...shadows.sm,
    borderWidth: 1.5, borderColor: colors.border, marginTop: 8,
  },
  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
    marginBottom: spacing.sm,
  },
  dateArrow: { padding: 8 },
  dateLabel: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.textPrimary },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  timeBtn: {
    borderRadius: borderRadius.md, borderWidth: 1.5, borderColor: colors.border,
    overflow: 'hidden', minWidth: 70,
  },
  timeBtnActive: { borderColor: colors.primary },
  timeBtnGrad: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  timeBtnText: {
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontWeight: '600',
    textAlign: 'center',
  },
  timeBtnTextActive: { fontSize: typography.fontSizes.sm, color: colors.white, fontWeight: '700' },
});
