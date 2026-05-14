import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, ActivityIndicator, Alert, TextInput, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import { couponAPI, paymentAPI, requestAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';


const BRAND_ICONS = {
  visa: 'card',
  mastercard: 'card',
  amex: 'card',
  pix: 'qr-code',
};

const BRAND_COLORS = {
  visa: '#1A1F71',
  mastercard: '#EB001B',
  amex: '#007BC1',
  discover: '#FF6600',
};

export default function PaymentScreen({ navigation, route }) {
  const { requestData, estimate, serviceType } = route.params;
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('card');
  const [savedMethods, setSavedMethods] = useState([]);
  const [walletCoupons, setWalletCoupons] = useState([]);
  const [selectedCouponCodes, setSelectedCouponCodes] = useState([]);
  const [couponInput, setCouponInput] = useState('');
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const { user } = useAuth();
  const totalWalletAvailable = Number((user?.clientWallet?.balance || 0) + (user?.wallet?.balance || 0));
  const [useWallet, setUseWallet] = useState(false);
  const [walletPreview, setWalletPreview] = useState({ walletApplied: 0, walletAppliedClient: 0, walletAppliedProfessional: 0 });
  const [pricingPreview, setPricingPreview] = useState({
    subtotal: estimate?.estimated || 0,
    discountTotal: 0,
    total: estimate?.estimated || 0,
    appliedCoupons: [],
    rejectedCoupons: [],
  });

  const initializePayment = useCallback(async () => {
    try {
      const [walletRes, methodsRes] = await Promise.all([
        couponAPI.myWallet().catch(() => ({ data: { coupons: [] } })),
        paymentAPI.getMethods().catch(() => ({ data: { methods: [] } })),
      ]);
      setWalletCoupons((walletRes.data.coupons || []).filter((c) => c.canUseNow));
      setSavedMethods(methodsRes.data.methods || []);
    } catch (err) {
      console.error('initializePayment error:', err);
      Alert.alert('Erro', 'Não foi possível carregar o pagamento. Tente novamente.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initializePayment();
  }, []);

  const refreshPreview = useCallback(async (couponCodes, applyWallet = useWallet) => {
    try {
      const { data } = await paymentAPI.preview(requestData, couponCodes, applyWallet);
      setPricingPreview({
        subtotal: data.subtotal || 0,
        discountTotal: data.discountTotal || 0,
        total: data.total || 0,
        appliedCoupons: data.appliedCoupons || [],
        rejectedCoupons: data.rejectedCoupons || [],
      });
      if (data.walletApplied !== undefined) {
        setWalletPreview({
          walletApplied: data.walletApplied || 0,
          walletAppliedClient: data.walletAppliedClient || 0,
          walletAppliedProfessional: data.walletAppliedProfessional || 0,
        });
      }
      return data;
    } catch {
      return null;
    }
  }, [requestData, useWallet]);

  useEffect(() => {
    if (!loading) refreshPreview(selectedCouponCodes, useWallet);
  }, [selectedCouponCodes, useWallet, loading, refreshPreview]);

  const toggleCoupon = async (code) => {
    const next = selectedCouponCodes.includes(code)
      ? selectedCouponCodes.filter((c) => c !== code)
      : [...selectedCouponCodes, code];
    const data = await refreshPreview(next);
    if (data?.rejectedCoupons?.some((r) => r.code === code)) {
      const rejected = data.rejectedCoupons.find((r) => r.code === code);
      Alert.alert('Cupom não aplicado', rejected?.reason || 'Este cupom não pode ser usado agora.');
      return;
    }
    setSelectedCouponCodes(next);
  };

  const redeemCouponInPayment = async () => {
    if (!couponInput.trim()) {
      Alert.alert('Atenção', 'Digite um código de cupom.');
      return;
    }
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
          Alert.alert('Cupom resgatado', `Cupom salvo, mas não aplicado agora: ${rejected?.reason || 'Regra do cupom'}`);
        } else {
          setSelectedCouponCodes(next);
          Alert.alert('Cupom aplicado', 'Cupom resgatado e aplicado ao pagamento.');
        }
      } else {
        Alert.alert('Cupom resgatado', 'Cupom salvo na carteira.');
      }
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível resgatar esse cupom.');
    } finally {
      setRedeemingCoupon(false);
    }
  };

  const handlePay = async () => {
    setPaying(true);
    try {
      if (selectedMethod === 'pix') {
        const { data } = await paymentAPI.createCoraPixCharge({
          ...requestData,
          couponCodes: selectedCouponCodes,
          useWallet,
        });

        if (data?.walletOnly) {
          navigation.replace('Searching', { requestId: data.request._id });
          return;
        }

        if (data?.charge?.rejectedCoupons?.length) {
          const lines = data.charge.rejectedCoupons.map((r) => `${r.code}: ${r.reason}`).join('\n');
          Alert.alert('Alguns cupons nao foram aplicados', lines);
        }

        navigation.navigate('PixCheckout', { charge: data.charge });
        setPaying(false);
        return;
      }

      const { data: intentData } = await paymentAPI.createIntent({
        ...requestData,
        couponCodes: selectedCouponCodes,
        useWallet,
      });

      if (intentData?.walletOnly) {
        navigation.replace('Searching', { requestId: intentData.request._id });
        return;
      }

      if (intentData?.rejectedCoupons?.length) {
        const lines = intentData.rejectedCoupons.map((r) => `${r.code}: ${r.reason}`).join('\n');
        Alert.alert('Alguns cupons não foram aplicados', lines);
      }

      const { clientSecret, paymentIntentId, ephemeralKey, customerId } = intentData;
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Já!',
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: 'ja-app://stripe-redirect',
        defaultBillingDetails: {},
        appearance: {
          colors: {
            primary: colors.primary,
            background: colors.background,
            componentBackground: colors.white,
            componentBorder: colors.border,
            componentDivider: colors.border,
            primaryText: colors.textPrimary,
            secondaryText: colors.textSecondary,
            componentText: colors.textPrimary,
          },
          shapes: {
            borderRadius: 12,
          },
        },
      });

      if (initError) {
        Alert.alert('Erro', 'Não foi possível inicializar o pagamento: ' + initError.message);
        setPaying(false);
        return;
      }

      const { error } = await presentPaymentSheet();

      if (error) {
        if (error.code === 'Canceled') {
          setPaying(false);
          return;
        }
        Alert.alert(
          'Pagamento recusado',
          error.message || 'Tente outro método de pagamento.',
          [{ text: 'Tentar novamente', onPress: () => setPaying(false) }]
        );
        return;
      }

      // Pagamento aprovado — criar o pedido no backend
      const { data } = await paymentAPI.confirm(paymentIntentId);
      navigation.replace('Searching', { requestId: data.request._id });
    } catch (err) {
      console.error('handlePay error:', err);
      Alert.alert('Erro', 'Ocorreu um erro ao processar o pagamento. Tente novamente.');
      setPaying(false);
    }
  };

  const formatBrand = (brand) => {
    const names = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', elo: 'Elo', hipercard: 'Hipercard' };
    return names[brand] || brand;
  };

  const { tierLabel, selectedUpsells = [], address } = requestData;
  const subtotal = Number(pricingPreview?.subtotal || estimate?.estimated || 0);
  const discountTotal = Number(pricingPreview?.discountTotal || 0);
  const total = Number(pricingPreview?.total || estimate?.estimated || 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <LinearGradient colors={colors.gradientPrimary} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pagamento</Text>
          <View style={{ width: 38 }} />
        </LinearGradient>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Preparando pagamento seguro...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pagamento</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Resumo do pedido */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resumo do pedido</Text>
          <View style={styles.summaryRow}>
            <Ionicons name="pricetag-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.summaryText}>{tierLabel || '-'}</Text>
          </View>
          {Array.isArray(selectedUpsells) && selectedUpsells.length > 0 && (
            <View style={styles.summaryRow}>
              <Ionicons name="add-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryText}>{selectedUpsells.map(k => k).join(', ')}</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.summaryText} numberOfLines={1}>{address.street}, {address.city}</Text>
          </View>
          {supportsProducts && hasProducts && (
            <View style={styles.summaryRow}>
              <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryText}>Você fornece os produtos</Text>
            </View>
          )}
        </View>

        {/* Métodos aceitos */}
        <View style={styles.methodsRow}>
          <TouchableOpacity
            style={[styles.methodChip, selectedMethod === 'card' && styles.methodChipActive]}
            onPress={() => setSelectedMethod('card')}
          >
            <Ionicons name="card-outline" size={14} color={colors.primary} />
            <Text style={styles.methodChipText}>Cartao</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodChip, selectedMethod === 'pix' && styles.methodChipActive]}
            onPress={() => setSelectedMethod('pix')}
          >
            <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
            <Text style={styles.methodChipText}>PIX</Text>
          </TouchableOpacity>
        </View>

        {/* Segurança */}
        <View style={styles.secureRow}>
          <Ionicons name="lock-closed" size={14} color={colors.success} />
          <Text style={styles.secureText}>
            {selectedMethod === 'pix'
              ? 'PIX com QR unico e expiracao em 15 minutos'
              : 'Pagamento seguro via Stripe · Dados criptografados'}
          </Text>
        </View>

        {/* Cartões salvos (preview) */}
        {savedMethods.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Seus cartões salvos</Text>
            {savedMethods.slice(0, 2).map((m) => (
              <View key={m.id} style={styles.savedCard}>
                <View style={[styles.savedCardBrand, { backgroundColor: BRAND_COLORS[m.brand] || '#666' }]}>
                  <Ionicons name="card" size={16} color="#fff" />
                </View>
                <View style={styles.savedCardInfo}>
                  <Text style={styles.savedCardName}>{formatBrand(m.brand)} •••• {m.last4}</Text>
                  <Text style={styles.savedCardExp}>Expira {m.expMonth}/{m.expYear}</Text>
                </View>
                {m.isDefault && (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultBadgeText}>Padrão</Text>
                  </View>
                )}
              </View>
            ))}
            <Text style={styles.savedCardsHint}>Selecione na próxima tela ou adicione um novo</Text>
          </View>
        )}

        {/* Cupons */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cupons de desconto</Text>
          <View style={styles.couponInputRow}>
            <TextInput
              value={couponInput}
              onChangeText={setCouponInput}
              autoCapitalize="characters"
              placeholder="Digite um cupom"
              placeholderTextColor={colors.textLight}
              style={styles.couponInput}
            />
            <TouchableOpacity style={styles.couponRedeemBtn} onPress={redeemCouponInPayment} disabled={redeemingCoupon}>
              {redeemingCoupon
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Text style={styles.couponRedeemText}>Resgatar</Text>}
            </TouchableOpacity>
          </View>

          {walletCoupons.length > 0 ? (
            <View style={{ gap: 8 }}>
              {walletCoupons.slice(0, 5).map((coupon) => {
                const selected = selectedCouponCodes.includes(coupon.code);
                return (
                  <TouchableOpacity
                    key={coupon.code}
                    style={[styles.couponRow, selected && styles.couponRowActive]}
                    onPress={() => toggleCoupon(coupon.code)}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={selected ? 'checkbox-outline' : 'square-outline'}
                      size={20}
                      color={selected ? colors.primary : colors.textLight}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.couponCode}>{coupon.code}</Text>
                      <Text style={styles.couponDesc}>{coupon.title}</Text>
                      <Text style={[styles.couponStack, coupon.stackable ? styles.couponStackOk : styles.couponStackBlock]}>
                        {coupon.stackable ? 'Combinável' : 'Não combinável'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noCouponText}>Sem cupons disponíveis na carteira.</Text>
          )}

          {pricingPreview.rejectedCoupons?.length > 0 && (
            <View style={styles.rejectedWrap}>
              {pricingPreview.rejectedCoupons.map((r) => (
                <Text key={`${r.code}-${r.reason}`} style={styles.rejectedText}>• {r.code}: {r.reason}</Text>
              ))}
            </View>
          )}
        </View>

        {/* Créditos da carteira */}
        {totalWalletAvailable > 0 && (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.walletToggleRow}
              onPress={() => setUseWallet((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={styles.walletToggleLeft}>
                <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                <View>
                  <Text style={styles.walletToggleTitle}>Usar créditos da carteira</Text>
                  <Text style={styles.walletToggleSub}>
                    Disponível: R$ {totalWalletAvailable.toFixed(2).replace('.', ',')}
                  </Text>
                </View>
              </View>
              <View style={[styles.walletToggleSwitch, useWallet && styles.walletToggleSwitchOn]}>
                <View style={[styles.walletToggleKnob, useWallet && styles.walletToggleKnobOn]} />
              </View>
            </TouchableOpacity>
            {useWallet && walletPreview.walletApplied > 0 && (
              <View style={styles.walletAppliedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={styles.walletAppliedText}>
                  R$ {walletPreview.walletApplied.toFixed(2).replace('.', ',')} de créditos aplicados
                </Text>
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* Footer com total + botão pagar */}
      <View style={styles.footer}>
        {discountTotal > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.subtotalLabel}>Subtotal</Text>
            <Text style={styles.subtotalValue}>R$ {subtotal.toFixed(2)}</Text>
          </View>
        )}
        {discountTotal > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.discountLabel}>Desconto em cupons</Text>
            <Text style={styles.discountValue}>- R$ {discountTotal.toFixed(2)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>R$ {total.toFixed(2)}</Text>
        </View>
        <TouchableOpacity
          style={styles.payBtnWrap}
          onPress={handlePay}
          disabled={paying}
          activeOpacity={0.85}
        >
          <LinearGradient colors={colors.gradientPrimary} style={styles.payBtn}>
            {paying
              ? <ActivityIndicator color={colors.white} />
              : (
                <>
                  <Ionicons name={selectedMethod === 'pix' ? 'qr-code' : 'lock-closed'} size={18} color={colors.white} />
                  <Text style={styles.payBtnText}>
                    {selectedMethod === 'pix'
                      ? `Gerar PIX R$ ${total.toFixed(2)}`
                      : `Pagar R$ ${total.toFixed(2)}`}
                  </Text>
                </>
              )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: colors.textSecondary },
  content: { flex: 1, padding: spacing.lg, gap: 16 },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 10,
    marginBottom: 14,
    ...shadows.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { fontSize: 14, color: colors.textSecondary, flex: 1 },
  savedCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedCardBrand: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  savedCardInfo: { flex: 1 },
  savedCardName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  savedCardExp: { fontSize: 12, color: colors.textSecondary },
  defaultBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  defaultBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  savedCardsHint: { fontSize: 12, color: colors.textLight, marginTop: 4 },
  couponInputRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  couponInput: {
    flex: 1,
    backgroundColor: '#F7F8FC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.textPrimary,
  },
  couponRedeemBtn: {
    minWidth: 94,
    borderRadius: 10,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  couponRedeemText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
  },
  couponRowActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF6F0',
  },
  couponCode: { fontSize: 12, color: colors.textLight, fontWeight: '700' },
  couponDesc: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', marginTop: 1 },
  couponStack: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '700',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  couponStackOk: { color: '#1565C0', backgroundColor: '#E3F2FD' },
  couponStackBlock: { color: '#C62828', backgroundColor: '#FFEBEE' },
  noCouponText: { fontSize: 12, color: colors.textLight },
  rejectedWrap: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFE0B2',
    padding: 8,
    gap: 4,
  },
  rejectedText: { fontSize: 12, color: '#E65100' },
  walletToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  walletToggleTitle: { fontSize: typography.fontSizes.sm, fontWeight: '700', color: colors.textPrimary },
  walletToggleSub: { fontSize: typography.fontSizes.xs, color: colors.textSecondary, marginTop: 2 },
  walletToggleSwitch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border,
    justifyContent: 'center', padding: 2,
  },
  walletToggleSwitchOn: { backgroundColor: colors.primary },
  walletToggleKnob: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  },
  walletToggleKnobOn: { alignSelf: 'flex-end' },
  walletAppliedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    backgroundColor: '#E8F5E9', borderRadius: 8, padding: 8,
  },
  walletAppliedText: { fontSize: typography.fontSizes.sm, color: colors.success, fontWeight: '600' },
  methodsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  methodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.white, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1.5, borderColor: colors.primary + '40',
    ...shadows.sm,
  },
  methodChipActive: {
    backgroundColor: '#FFF3EA',
    borderColor: colors.primary,
  },
  methodChipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  secureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
    marginBottom: 14,
  },
  secureText: { fontSize: 12, color: colors.textSecondary },
  footer: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subtotalLabel: { fontSize: 13, color: colors.textSecondary },
  subtotalValue: { fontSize: 13, color: colors.textSecondary, textDecorationLine: 'line-through' },
  discountLabel: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },
  discountValue: { fontSize: 13, color: '#2E7D32', fontWeight: '700' },
  totalLabel: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  payBtnWrap: { borderRadius: borderRadius.lg, overflow: 'hidden' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  payBtnText: { fontSize: 17, fontWeight: '800', color: colors.white },
});
