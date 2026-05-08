import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import { paymentAPI } from '../../services/api';
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
  const { requestData, estimate } = route.params;
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [savedMethods, setSavedMethods] = useState([]);

  const initializePayment = useCallback(async () => {
    try {
      // Buscar savedMethods e criar intent em paralelo
      const [intentRes, methodsRes] = await Promise.all([
        paymentAPI.createIntent(requestData),
        paymentAPI.getMethods().catch(() => ({ data: { methods: [] } })),
      ]);

      const { clientSecret, paymentIntentId: piId, ephemeralKey, customerId } = intentRes.data;
      setSavedMethods(methodsRes.data.methods || []);
      setPaymentIntentId(piId);

      const { error } = await initPaymentSheet({
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

      if (error) {
        Alert.alert('Erro', 'Não foi possível inicializar o pagamento: ' + error.message);
        navigation.goBack();
      }
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

  const handlePay = async () => {
    setPaying(true);
    try {
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

  const { hours, hasProducts, address } = requestData;
  const total = estimate?.estimated || 0;

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

      <View style={styles.content}>
        {/* Resumo do pedido */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resumo do pedido</Text>
          <View style={styles.summaryRow}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.summaryText}>{hours}h de limpeza</Text>
          </View>
          <View style={styles.summaryRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.summaryText} numberOfLines={1}>{address.street}, {address.city}</Text>
          </View>
          {hasProducts && (
            <View style={styles.summaryRow}>
              <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryText}>Você fornece os produtos</Text>
            </View>
          )}
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

        {/* Métodos aceitos */}
        <View style={styles.methodsRow}>
          <View style={styles.methodChip}>
            <Ionicons name="card-outline" size={14} color={colors.primary} />
            <Text style={styles.methodChipText}>Crédito</Text>
          </View>
          <View style={styles.methodChip}>
            <Ionicons name="card-outline" size={14} color={colors.primary} />
            <Text style={styles.methodChipText}>Débito</Text>
          </View>
          <View style={styles.methodChip}>
            <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
            <Text style={styles.methodChipText}>PIX</Text>
          </View>
        </View>

        {/* Segurança */}
        <View style={styles.secureRow}>
          <Ionicons name="lock-closed" size={14} color={colors.success} />
          <Text style={styles.secureText}>Pagamento seguro via Stripe · Dados criptografados</Text>
        </View>
      </View>

      {/* Footer com total + botão pagar */}
      <View style={styles.footer}>
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
                  <Ionicons name="lock-closed" size={18} color={colors.white} />
                  <Text style={styles.payBtnText}>Pagar R$ {total.toFixed(2)}</Text>
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
  methodsRow: { flexDirection: 'row', gap: 10 },
  methodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.white, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1.5, borderColor: colors.primary + '40',
    ...shadows.sm,
  },
  methodChipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  secureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
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
  totalLabel: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  payBtnWrap: { borderRadius: borderRadius.lg, overflow: 'hidden' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  payBtnText: { fontSize: 17, fontWeight: '800', color: colors.white },
});
