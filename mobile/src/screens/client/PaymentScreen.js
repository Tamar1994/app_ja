import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Modal, Pressable,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator,
  Alert, TextInput, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { couponAPI, paymentAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectBrand(number) {
  const n = String(number || '').replace(/\D/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]|^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|636368|6362)/.test(n)) return 'elo';
  return 'unknown';
}

const BRAND_LABEL = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', elo: 'Elo', unknown: 'Cartao' };

const BRAND_CONFIG = {
  visa:       { bg: '#1A1F71', label: 'VISA', labelColor: '#fff' },
  mastercard: { bg: '#EB001B', label: 'MC',   labelColor: '#fff' },
  amex:       { bg: '#007BC1', label: 'AMEX', labelColor: '#fff' },
  elo:        { bg: '#D4A017', label: 'ELO',  labelColor: '#fff' },
  unknown:    { bg: '#94A3B8', label: 'XX',   labelColor: '#fff' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function BrandBadge({ brand, size = 38 }) {
  const cfg = BRAND_CONFIG[brand] || BRAND_CONFIG.unknown;
  return (
    <View style={{ width: size, height: Math.round(size * 0.64), backgroundColor: cfg.bg, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: cfg.labelColor, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>{cfg.label}</Text>
    </View>
  );
}

function SavedCardItem({ card, selected, onPress, onDelete }) {
  const brandName = BRAND_LABEL[card.brand] || 'Cartao';
  return (
    <TouchableOpacity style={[styles.savedCard, selected && styles.savedCardSelected]} onPress={onPress} activeOpacity={0.8}>
      <BrandBadge brand={card.brand} size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.savedCardTitle}>{brandName} {'\u2022\u2022\u2022\u2022'}{card.lastFour}</Text>
        <Text style={styles.savedCardSub}>{card.holderName ? card.holderName + ' · ' : ''}{card.expiryMonth}/{String(card.expiryYear || '').slice(-2)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {selected && (<View style={styles.checkCircle}><Ionicons name="checkmark" size={12} color="#fff" /></View>)}
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="trash-outline" size={17} color={colors.textLight} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function DeclinedModal({ visible, message, onTryAnother, onSwitchPix, onCancel }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <Ionicons name="close-circle" size={48} color={colors.error} style={{ marginBottom: 10 }} />
            <Text style={styles.declinedTitle}>Cartao nao autorizado</Text>
            {!!message && <Text style={styles.declinedMsg}>{message}</Text>}
          </View>
          <TouchableOpacity style={styles.sheetBtnPrimary} onPress={onTryAnother} activeOpacity={0.85}>
            <LinearGradient colors={colors.gradientPrimary} style={styles.sheetBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Ionicons name="card-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.sheetBtnPrimaryText}>Tentar outro cartao</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetBtnSecondary} onPress={onSwitchPix} activeOpacity={0.85}>
            <Ionicons name="qr-code-outline" size={18} color={colors.secondary} style={{ marginRight: 8 }} />
            <Text style={styles.sheetBtnSecondaryText}>Pagar com PIX</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetBtnDanger} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.sheetBtnDangerText}>Cancelar solicitacao</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function PaymentScreen({ navigation, route }) {
  const { requestData, estimate } = route.params;
  const isScheduled = !!requestData?.isScheduled;
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('card');

  // Saved cards
  const [savedCards, setSavedCards] = useState([]);
  const [selectedSavedCardId, setSelectedSavedCardId] = useState(null);
  const [showNewCardForm, setShowNewCardForm] = useState(true);
  const [saveCard, setSaveCard] = useState(true);

  // Card form
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const cardBrand = detectBrand(cardNumber);

  // Declined modal
  const [declined, setDeclined] = useState({ visible: false, message: '' });

  // Coupons
  const [walletCoupons, setWalletCoupons] = useState([]);
  const [selectedCouponCodes, setSelectedCouponCodes] = useState([]);
  const [couponInput, setCouponInput] = useState('');
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);

  // Wallet
  const totalWalletAvailable = Number((user?.clientWallet?.balance || 0) + (user?.wallet?.balance || 0));
  const [useWallet, setUseWallet] = useState(false);
  const [walletPreview, setWalletPreview] = useState({ walletApplied: 0, walletAppliedClient: 0, walletAppliedProfessional: 0 });

  // Pricing
  const [pricingPreview, setPricingPreview] = useState({
    subtotal: estimate?.estimated || 0,
    discountTotal: 0,
    total: estimate?.estimated || 0,
    appliedCoupons: [],
    rejectedCoupons: [],
  });

  // ── Initialize ──────────────────────────────────────────────────────────────

  const initializePayment = useCallback(async () => {
    try {
      const [walletRes, cardsRes] = await Promise.allSettled([
        couponAPI.myWallet().catch(() => ({ data: { coupons: [] } })),
        paymentAPI.getSavedCards().catch(() => ({ data: { cards: [] } })),
      ]);
      const coupons = walletRes.status === 'fulfilled' ? (walletRes.value?.data?.coupons || []).filter((c) => c.canUseNow) : [];
      setWalletCoupons(coupons);
      const cards = cardsRes.status === 'fulfilled' ? (cardsRes.value?.data?.cards || []) : [];
      setSavedCards(cards);
      if (cards.length) {
        const def = cards.find((c) => c.isDefault) || cards[0];
        setSelectedSavedCardId(def._id);
        setShowNewCardForm(false);
      }
    } catch (err) {
      console.error('initializePayment error:', err);
      Alert.alert('Erro', 'Nao foi possivel carregar o pagamento. Tente novamente.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { initializePayment(); }, []);

  // ── Pricing ─────────────────────────────────────────────────────────────────

  const refreshPreview = useCallback(async (couponCodes, applyWallet = useWallet) => {
    try {
      const { data } = await paymentAPI.preview(requestData, couponCodes, applyWallet);
      setPricingPreview({ subtotal: data.subtotal || 0, discountTotal: data.discountTotal || 0, total: data.total || 0, appliedCoupons: data.appliedCoupons || [], rejectedCoupons: data.rejectedCoupons || [] });
      if (data.walletApplied !== undefined) {
        setWalletPreview({ walletApplied: data.walletApplied || 0, walletAppliedClient: data.walletAppliedClient || 0, walletAppliedProfessional: data.walletAppliedProfessional || 0 });
      }
      return data;
    } catch { return null; }
  }, [requestData, useWallet]);

  useEffect(() => { if (!loading) refreshPreview(selectedCouponCodes, useWallet); }, [selectedCouponCodes, useWallet, loading]);

  // ── Coupons ─────────────────────────────────────────────────────────────────

  const toggleCoupon = async (code) => {
    const next = selectedCouponCodes.includes(code) ? selectedCouponCodes.filter((c) => c !== code) : [...selectedCouponCodes, code];
    const data = await refreshPreview(next);
    if (data?.rejectedCoupons?.some((r) => r.code === code)) {
      const rejected = data.rejectedCoupons.find((r) => r.code === code);
      Alert.alert('Cupom nao aplicado', rejected?.reason || 'Este cupom nao pode ser usado agora.');
      return;
    }
    setSelectedCouponCodes(next);
  };

  const redeemCouponInPayment = async () => {
    if (!couponInput.trim()) { Alert.alert('Atencao', 'Digite um codigo de cupom.'); return; }
    setRedeemingCoupon(true);
    try {
      await couponAPI.redeem(couponInput.trim());
      const wallet = await couponAPI.myWallet();
      const nextWallet = (wallet.data.coupons || []).filter((c) => c.canUseNow);
      setWalletCoupons(nextWallet);
      const normalized = couponInput.trim().toUpperCase();
      setCouponInput('');
      if (nextWallet.some((c) => c.code === normalized)) {
        const next = Array.from(new Set([...selectedCouponCodes, normalized]));
        const data = await refreshPreview(next);
        if (data?.rejectedCoupons?.some((r) => r.code === normalized)) {
          const rejected = data.rejectedCoupons.find((r) => r.code === normalized);
          Alert.alert('Cupom resgatado', 'Cupom salvo, mas nao aplicado: ' + (rejected?.reason || 'Regra do cupom'));
        } else {
          setSelectedCouponCodes(next);
          Alert.alert('Cupom aplicado', 'Desconto adicionado ao pagamento.');
        }
      } else {
        Alert.alert('Cupom resgatado', 'Cupom salvo na carteira.');
      }
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Nao foi possivel resgatar esse cupom.');
    } finally {
      setRedeemingCoupon(false);
    }
  };

  // ── Delete saved card ───────────────────────────────────────────────────────

  const handleDeleteCard = (cardId) => {
    Alert.alert('Remover cartao', 'Deseja remover este cartao salvo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: async () => {
        try {
          await paymentAPI.deleteSavedCard(cardId);
          const next = savedCards.filter((c) => c._id !== cardId);
          setSavedCards(next);
          if (selectedSavedCardId === cardId) {
            if (next.length) { setSelectedSavedCardId(next[0]._id); }
            else { setSelectedSavedCardId(null); setShowNewCardForm(true); }
          }
        } catch { Alert.alert('Erro', 'Nao foi possivel remover o cartao.'); }
      }},
    ]);
  };

  // ── Pay ─────────────────────────────────────────────────────────────────────

  const handlePay = async () => {
    setPaying(true);
    try {
      if (selectedMethod === 'pix') {
        const { data } = await paymentAPI.createPixCharge({ ...requestData, couponCodes: selectedCouponCodes, useWallet, walletAmount: walletPreview.walletApplied > 0 ? walletPreview.walletApplied : undefined });
        if (data?.walletOnly) { navigation.replace(isScheduled ? 'ScheduledPending' : 'Searching', { requestId: data.request._id }); return; }
        if (data?.charge?.rejectedCoupons?.length) {
          const lines = data.charge.rejectedCoupons.map((r) => r.code + ': ' + r.reason).join('\n');
          Alert.alert('Cupons nao aplicados', lines);
        }
        navigation.navigate('PixCheckout', { charge: data.charge, isScheduled });
        setPaying(false);
        return;
      }

      // Card
      let cardPayload;
      if (selectedSavedCardId && !showNewCardForm) {
        cardPayload = { savedCardId: selectedSavedCardId };
      } else {
        const rawNumber = cardNumber.replace(/\s/g, '');
        if (!rawNumber || rawNumber.length < 13) { Alert.alert('Atencao', 'Numero de cartao invalido.'); setPaying(false); return; }
        if (!cardHolder.trim()) { Alert.alert('Atencao', 'Nome do titular e obrigatorio.'); setPaying(false); return; }
        const parts = cardExpiry.split('/');
        const expMonth = parts[0] || '';
        const expYear  = parts[1] || '';
        if (!expMonth || !expYear || expMonth.length !== 2 || expYear.length !== 2) { Alert.alert('Atencao', 'Validade invalida. Use MM/AA.'); setPaying(false); return; }
        const now = new Date();
        const cardFullYear = 2000 + Number(expYear);
        if (cardFullYear < now.getFullYear() || (cardFullYear === now.getFullYear() && Number(expMonth) < now.getMonth() + 1)) { Alert.alert('Cartao vencido', 'A validade do cartao esta expirada.'); setPaying(false); return; }
        if (!cardCvv || cardCvv.length < 3) { Alert.alert('Atencao', 'CVV invalido.'); setPaying(false); return; }
        cardPayload = { holderName: cardHolder.trim(), cardNumber: rawNumber, expiryMonth: expMonth, expiryYear: expYear, ccv: cardCvv, saveCard };
      }

      const { data } = await paymentAPI.cardPay({ ...cardPayload, ...requestData, couponCodes: selectedCouponCodes, useWallet });
      if (data?.walletOnly) { navigation.replace(isScheduled ? 'ScheduledPending' : 'Searching', { requestId: data.request._id }); return; }
      navigation.replace(isScheduled ? 'ScheduledPending' : 'Searching', { requestId: data.request._id });
    } catch (err) {
      console.error('handlePay error:', err);
      const status = err?.response?.status;
      const backendMsg = err?.response?.data?.message;
      if (status === 402) {
        setDeclined({ visible: true, message: backendMsg || 'Cartao nao autorizado pela operadora.' });
      } else {
        Alert.alert('Erro no pagamento', backendMsg || 'Ocorreu um erro. Tente novamente.');
      }
      setPaying(false);
    }
  };

  const onDeclinedTryAnother = () => {
    setDeclined({ visible: false, message: '' });
    setShowNewCardForm(true);
    setSelectedSavedCardId(null);
    setCardNumber(''); setCardHolder(''); setCardExpiry(''); setCardCvv('');
  };
  const onDeclinedSwitchPix = () => { setDeclined({ visible: false, message: '' }); setSelectedMethod('pix'); };
  const onDeclinedCancel    = () => { setDeclined({ visible: false, message: '' }); navigation.goBack(); };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const { tierLabel, selectedUpsells = [], address } = requestData;
  const subtotal      = Number(pricingPreview?.subtotal || estimate?.estimated || 0);
  const discountTotal = Number(pricingPreview?.discountTotal || 0);
  const walletApplied = Number(walletPreview?.walletApplied || 0);
  const total         = Number(pricingPreview?.total || estimate?.estimated || 0);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pagamento</Text>
          <View style={{ width: 36 }} />
        </LinearGradient>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando pagamento seguro...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pagamento</Text>
        <View style={styles.headerLock}>
          <Ionicons name="lock-closed" size={14} color="rgba(255,255,255,0.9)" />
        </View>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Resumo do pedido */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="receipt-outline" size={16} color={colors.primary} />
              <Text style={styles.cardTitle}>Resumo do pedido</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}><Ionicons name="pricetag-outline" size={15} color={colors.textSecondary} /><Text style={styles.summaryLabel}>{tierLabel || '-'}</Text></View>
            {Array.isArray(selectedUpsells) && selectedUpsells.length > 0 && (
              <View style={styles.summaryRow}><Ionicons name="add-circle-outline" size={15} color={colors.textSecondary} /><Text style={styles.summaryLabel} numberOfLines={2}>{estimate?.upsells?.length ? estimate.upsells.map((u) => u.label).join(', ') : selectedUpsells.join(', ')}</Text></View>
            )}
            {estimate?.dayNightBreakdown?.nightMinutes > 0 && (<>
              <View style={styles.summaryRow}><Ionicons name="sunny-outline" size={15} color={colors.textSecondary} /><Text style={styles.summaryLabel}>Diurno {estimate.dayNightBreakdown.dayMinutes}min — R$ {Number(estimate.dayNightBreakdown.dayPrice).toFixed(2).replace('.', ',')}</Text></View>
              <View style={styles.summaryRow}><Ionicons name="moon-outline" size={15} color={colors.textSecondary} /><Text style={styles.summaryLabel}>Noturno {estimate.dayNightBreakdown.nightMinutes}min — R$ {Number(estimate.dayNightBreakdown.nightPrice).toFixed(2).replace('.', ',')}</Text></View>
            </>)}
            <View style={styles.summaryRow}><Ionicons name="location-outline" size={15} color={colors.textSecondary} /><Text style={styles.summaryLabel} numberOfLines={1}>{address.street}, {address.city}</Text></View>
            <View style={[styles.summaryRow, { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
              <Text style={styles.summarySubtotalLabel}>Subtotal</Text>
              <Text style={styles.summarySubtotalValue}>R$ {subtotal.toFixed(2).replace('.', ',')}</Text>
            </View>
          </View>

          {/* Metodo de pagamento */}
          <View style={styles.methodSelector}>
            <TouchableOpacity style={[styles.methodTab, selectedMethod === 'card' && styles.methodTabActive]} onPress={() => setSelectedMethod('card')} activeOpacity={0.8}>
              <Ionicons name="card" size={18} color={selectedMethod === 'card' ? colors.primary : colors.textSecondary} />
              <Text style={[styles.methodTabLabel, selectedMethod === 'card' && styles.methodTabLabelActive]}>Cartao</Text>
            </TouchableOpacity>
            <View style={styles.methodDivider} />
            <TouchableOpacity style={[styles.methodTab, selectedMethod === 'pix' && styles.methodTabActive]} onPress={() => setSelectedMethod('pix')} activeOpacity={0.8}>
              <Ionicons name="qr-code" size={18} color={selectedMethod === 'pix' ? colors.primary : colors.textSecondary} />
              <Text style={[styles.methodTabLabel, selectedMethod === 'pix' && styles.methodTabLabelActive]}>PIX</Text>
            </TouchableOpacity>
          </View>

          {/* PIX info */}
          {selectedMethod === 'pix' && (
            <View style={styles.card}>
              <View style={styles.pixInfoRow}>
                <View style={styles.pixIconWrap}><Ionicons name="qr-code" size={26} color={colors.secondary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pixInfoTitle}>PIX — pagamento instantaneo</Text>
                  <Text style={styles.pixInfoSub}>Um QR Code unico e seguro sera gerado. Valido por 30 minutos.</Text>
                </View>
              </View>
              <View style={styles.divider} />
              {[
                'Confirmacao imediata',
                'Sem taxas adicionais',
                'Dados nao sao compartilhados',
              ].map((feat) => (
                <View key={feat} style={styles.pixFeatureRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={styles.pixFeatureText}>{feat}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Secao cartao */}
          {selectedMethod === 'card' && (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="card-outline" size={16} color={colors.primary} />
                <Text style={styles.cardTitle}>{savedCards.length > 0 && !showNewCardForm ? 'Seus cartoes' : 'Dados do cartao'}</Text>
              </View>
              <View style={styles.divider} />

              {/* Lista de cartoes salvos */}
              {savedCards.length > 0 && !showNewCardForm && (<>
                {savedCards.map((c) => (
                  <SavedCardItem key={c._id} card={c} selected={selectedSavedCardId === c._id} onPress={() => setSelectedSavedCardId(c._id)} onDelete={() => handleDeleteCard(c._id)} />
                ))}
                <TouchableOpacity style={styles.addCardBtn} onPress={() => { setShowNewCardForm(true); setSelectedSavedCardId(null); }} activeOpacity={0.8}>
                  <View style={styles.addCardIcon}><Ionicons name="add" size={18} color={colors.primary} /></View>
                  <Text style={styles.addCardText}>Adicionar novo cartao</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
                </TouchableOpacity>
              </>)}

              {/* Form novo cartao */}
              {showNewCardForm && (<>
                {savedCards.length > 0 && (
                  <TouchableOpacity style={styles.backToSavedBtn} onPress={() => { setShowNewCardForm(false); setSelectedSavedCardId(savedCards.find((c) => c.isDefault)?._id || savedCards[0]._id); }} activeOpacity={0.8}>
                    <Ionicons name="arrow-back" size={16} color={colors.primary} />
                    <Text style={styles.backToSavedText}>Usar cartao salvo</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>Numero do cartao</Text>
                  <View style={styles.cardNumberRow}>
                    <TextInput value={cardNumber} onChangeText={(t) => { const d = t.replace(/\D/g, '').slice(0, 16); setCardNumber(d.replace(/(\d{4})(?=\d)/g, '$1 ')); }} keyboardType="numeric" placeholder="0000 0000 0000 0000" placeholderTextColor={colors.textLight} style={[styles.input, { flex: 1 }]} maxLength={19} />
                    <View style={{ marginLeft: 8 }}><BrandBadge brand={cardBrand} size={36} /></View>
                  </View>
                </View>

                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>Nome impresso no cartao</Text>
                  <TextInput value={cardHolder} onChangeText={setCardHolder} autoCapitalize="characters" placeholder="NOME COMPLETO" placeholderTextColor={colors.textLight} style={styles.input} />
                </View>

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={[styles.inputWrap, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Validade</Text>
                    <TextInput value={cardExpiry} onChangeText={(t) => { const d = t.replace(/\D/g, '').slice(0, 4); setCardExpiry(d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d); }} keyboardType="numeric" placeholder="MM/AA" placeholderTextColor={colors.textLight} style={styles.input} maxLength={5} />
                  </View>
                  <View style={[styles.inputWrap, { flex: 1 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.inputLabel}>CVV</Text>
                      <Ionicons name="help-circle-outline" size={15} color={colors.textLight} />
                    </View>
                    <TextInput value={cardCvv} onChangeText={(t) => setCardCvv(t.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" placeholder="..." placeholderTextColor={colors.textLight} style={styles.input} secureTextEntry maxLength={4} />
                  </View>
                </View>

                <View style={styles.saveCardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.saveCardLabel}>Salvar cartao para proximas compras</Text>
                    <Text style={styles.saveCardSub}>Dados armazenados com seguranca</Text>
                  </View>
                  <Switch value={saveCard} onValueChange={setSaveCard} trackColor={{ false: colors.border, true: colors.primaryLight }} thumbColor={saveCard ? colors.primary : '#f4f3f4'} />
                </View>
              </>)}
            </View>
          )}

          {/* Cupons */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="pricetag-outline" size={16} color={colors.primary} />
              <Text style={styles.cardTitle}>Cupons de desconto</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.couponRow}>
              <TextInput value={couponInput} onChangeText={setCouponInput} autoCapitalize="characters" placeholder="Codigo do cupom" placeholderTextColor={colors.textLight} style={styles.couponInput} returnKeyType="done" onSubmitEditing={redeemCouponInPayment} />
              <TouchableOpacity style={styles.couponRedeemBtn} onPress={redeemCouponInPayment} disabled={redeemingCoupon} activeOpacity={0.85}>
                {redeemingCoupon ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.couponRedeemText}>Resgatar</Text>}
              </TouchableOpacity>
            </View>
            {walletCoupons.length > 0 && (
              <View style={{ gap: 8, marginTop: 8 }}>
                {walletCoupons.slice(0, 5).map((coupon) => {
                  const selected = selectedCouponCodes.includes(coupon.code);
                  return (
                    <TouchableOpacity key={coupon.code} style={[styles.couponChip, selected && styles.couponChipActive]} onPress={() => toggleCoupon(coupon.code)} activeOpacity={0.8}>
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? colors.primary : colors.textLight} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.couponChipCode, selected && styles.couponChipCodeActive]}>{coupon.code}</Text>
                        {coupon.description ? <Text style={styles.couponChipDesc}>{coupon.description}</Text> : null}
                      </View>
                      {coupon.discountValue ? <Text style={styles.couponChipDiscount}>{coupon.discountType === 'percentage' ? '-' + coupon.discountValue + '%' : '-R$ ' + Number(coupon.discountValue).toFixed(2).replace('.', ',')}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Carteira */}
          {totalWalletAvailable > 0 && (
            <View style={styles.card}>
              <View style={styles.walletRow}>
                <View style={styles.walletIconWrap}><Ionicons name="wallet-outline" size={20} color={colors.success} /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.walletLabel}>Creditos da carteira</Text>
                  <Text style={styles.walletBalance}>R$ {totalWalletAvailable.toFixed(2).replace('.', ',')} disponiveis</Text>
                </View>
                <Switch value={useWallet} onValueChange={setUseWallet} trackColor={{ false: colors.border, true: '#A7F3D0' }} thumbColor={useWallet ? colors.success : '#f4f3f4'} />
              </View>
              {useWallet && walletApplied > 0 && (
                <View style={styles.walletAppliedBanner}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.walletAppliedText}>R$ {walletApplied.toFixed(2).replace('.', ',')} de desconto aplicado</Text>
                </View>
              )}
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerBreakdown}>
          {discountTotal > 0 && (
            <View style={styles.footerRow}>
              <Text style={styles.footerRowLabel}>Desconto</Text>
              <Text style={[styles.footerRowValue, { color: colors.success }]}>- R$ {discountTotal.toFixed(2).replace('.', ',')}</Text>
            </View>
          )}
          {useWallet && walletApplied > 0 && (
            <View style={styles.footerRow}>
              <Text style={styles.footerRowLabel}>Creditos da carteira</Text>
              <Text style={[styles.footerRowValue, { color: colors.success }]}>- R$ {walletApplied.toFixed(2).replace('.', ',')}</Text>
            </View>
          )}
          <View style={[styles.footerRow, styles.footerTotalRow]}>
            <Text style={styles.footerTotalLabel}>Total</Text>
            <Text style={styles.footerTotalValue}>R$ {total.toFixed(2).replace('.', ',')}</Text>
          </View>
        </View>

        <TouchableOpacity onPress={handlePay} disabled={paying} activeOpacity={0.88} style={styles.payBtnWrap}>
          <LinearGradient colors={paying ? ['#B0BEC5', '#90A4AE'] : colors.gradientPrimary} style={styles.payBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {paying
              ? <ActivityIndicator color="#fff" size="small" />
              : (<>
                  <Ionicons name={selectedMethod === 'pix' ? 'qr-code-outline' : 'lock-closed-outline'} size={18} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.payBtnLabel}>{selectedMethod === 'pix' ? 'Gerar QR Code' : 'Pagar R$ ' + total.toFixed(2).replace('.', ',')}</Text>
                </>)}
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.secureRow}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.textLight} />
          <Text style={styles.secureText}>Pagamento 100% seguro — Criptografia de ponta a ponta</Text>
        </View>
      </View>

      <DeclinedModal visible={declined.visible} message={declined.message} onTryAnother={onDeclinedTryAnother} onSwitchPix={onDeclinedSwitchPix} onCancel={onDeclinedCancel} />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6FB' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 14 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  headerLock: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textSecondary, fontSize: 14 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 12 },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, letterSpacing: 0.1 },
  divider: { height: 1, backgroundColor: '#F0F2F8', marginBottom: 14, marginTop: -4 },

  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  summaryLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  summarySubtotalLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  summarySubtotalValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  methodSelector: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', shadowColor: '#1A1A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  methodTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  methodTabActive: { backgroundColor: '#FFF5EE', borderBottomWidth: 2, borderBottomColor: colors.primary },
  methodTabLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  methodTabLabelActive: { color: colors.primary },
  methodDivider: { width: 1, backgroundColor: '#F0F2F8', marginVertical: 10 },

  pixInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 14 },
  pixIconWrap: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#EEF4FF', alignItems: 'center', justifyContent: 'center' },
  pixInfoTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  pixInfoSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  pixFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pixFeatureText: { fontSize: 13, color: colors.textSecondary },

  savedCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#EEF0F8', borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: '#FAFBFF' },
  savedCardSelected: { borderColor: colors.primary, backgroundColor: '#FFF8F4' },
  savedCardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  savedCardSub: { fontSize: 12, color: colors.textSecondary },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

  addCardBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#F0F2F8', marginTop: 4 },
  addCardIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFF3EA', alignItems: 'center', justifyContent: 'center' },
  addCardText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.primary },

  backToSavedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backToSavedText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  inputWrap: { marginBottom: 12 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, letterSpacing: 0.2 },
  input: { backgroundColor: '#F7F8FC', borderWidth: 1.5, borderColor: '#E8EBF5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  cardNumberRow: { flexDirection: 'row', alignItems: 'center' },

  saveCardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F0F2F8', gap: 12 },
  saveCardLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  saveCardSub: { fontSize: 11, color: colors.textLight },

  couponRow: { flexDirection: 'row', gap: 10, marginBottom: 2 },
  couponInput: { flex: 1, backgroundColor: '#F7F8FC', borderWidth: 1.5, borderColor: '#E8EBF5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.textPrimary, fontWeight: '600', letterSpacing: 0.5 },
  couponRedeemBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minWidth: 80, minHeight: 44 },
  couponRedeemText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  couponChip: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1.5, borderColor: '#EEF0F8', borderRadius: 12, backgroundColor: '#FAFBFF' },
  couponChipActive: { borderColor: colors.primary, backgroundColor: '#FFF8F4' },
  couponChipCode: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, letterSpacing: 0.3 },
  couponChipCodeActive: { color: colors.primary },
  couponChipDesc: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  couponChipDiscount: { fontSize: 13, fontWeight: '700', color: colors.success },

  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  walletIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#E8FFF2', alignItems: 'center', justifyContent: 'center' },
  walletLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  walletBalance: { fontSize: 12, color: colors.success, fontWeight: '600' },
  walletAppliedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E8FFF2', borderRadius: 8, padding: 8, marginTop: 10 },
  walletAppliedText: { fontSize: 12, color: colors.success, fontWeight: '600' },

  footer: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEF0F8', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 20 : 14, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 10 },
  footerBreakdown: { marginBottom: 12, gap: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerRowLabel: { fontSize: 13, color: colors.textSecondary },
  footerRowValue: { fontSize: 13, fontWeight: '600' },
  footerTotalRow: { borderTopWidth: 1, borderTopColor: '#EEF0F8', paddingTop: 8, marginTop: 4 },
  footerTotalLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  footerTotalValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  payBtnWrap: { marginBottom: 8 },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 16, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
  payBtnLabel: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secureText: { fontSize: 11, color: colors.textLight },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 36 : 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DEE1EC', alignSelf: 'center', marginBottom: 20 },
  declinedTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 6 },
  declinedMsg: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10, marginBottom: 4 },
  sheetBtnPrimary: { borderRadius: 14, overflow: 'hidden', marginTop: 16 },
  sheetBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14 },
  sheetBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sheetBtnSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.secondary, borderRadius: 14, paddingVertical: 13, marginTop: 10 },
  sheetBtnSecondaryText: { color: colors.secondary, fontSize: 15, fontWeight: '700' },
  sheetBtnDanger: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  sheetBtnDangerText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
