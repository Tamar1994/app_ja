import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { couponAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

function CouponCard({ coupon }) {
  const discountLabel = coupon.discountType === 'percent'
    ? `${coupon.discountValue}%${coupon.maxDiscount ? ` (máx. ${money(coupon.maxDiscount)})` : ''}`
    : money(coupon.discountValue);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.code}>{coupon.code}</Text>
          <Text style={styles.title}>{coupon.title}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{discountLabel}</Text>
        </View>
      </View>

      {!!coupon.description && <Text style={styles.desc}>{coupon.description}</Text>}

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Uso: {coupon.usage?.userUsed || 0}/{coupon.maxUsesPerUser || '∞'}</Text>
        <Text style={styles.metaText}>Min: {money(coupon.minOrderValue || 0)}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.stackTag, coupon.stackable ? styles.stackOk : styles.stackBlock]}>
          {coupon.stackable ? 'Combinável com outros' : 'Não combinável'}
        </Text>
        {!coupon.canUseNow && (
          <Text style={styles.blockedText}>{coupon.blockedReason || 'Indisponível no momento'}</Text>
        )}
      </View>
    </View>
  );
}

export default function CouponWalletScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [code, setCode] = useState('');
  const [coupons, setCoupons] = useState([]);

  const load = useCallback(async () => {
    try {
      const { data } = await couponAPI.myWallet();
      setCoupons(data.coupons || []);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar sua carteira de cupons.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const redeem = async () => {
    if (!code.trim()) {
      Alert.alert('Atenção', 'Digite um código de cupom.');
      return;
    }
    setRedeeming(true);
    try {
      const { data } = await couponAPI.redeem(code.trim());
      setCode('');
      Alert.alert('Sucesso', data.message || 'Cupom resgatado!');
      load();
    } catch (err) {
      Alert.alert('Cupom inválido', err?.response?.data?.message || 'Não foi possível resgatar o cupom.');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient colors={['#1976D2', '#1565C0']} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Carteira de Cupons</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.redeemCard}>
            <Text style={styles.redeemTitle}>Resgatar novo cupom</Text>
            <View style={styles.redeemRow}>
              <TextInput
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                placeholder="Digite o código"
                placeholderTextColor={colors.textLight}
                style={styles.input}
              />
              <TouchableOpacity style={styles.redeemBtn} onPress={redeem} disabled={redeeming}>
                {redeeming
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Text style={styles.redeemBtnText}>Resgatar</Text>}
              </TouchableOpacity>
            </View>
            <Text style={styles.redeemHint}>Você também pode aplicar códigos diretamente na tela de pagamento.</Text>
          </View>

          {coupons.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="ticket-outline" size={48} color={colors.textLight} />
              <Text style={styles.emptyTitle}>Nenhum cupom na carteira</Text>
              <Text style={styles.emptySub}>Resgate um código para começar.</Text>
            </View>
          ) : (
            coupons.map((coupon) => <CouponCard key={coupon.id || coupon.code} coupon={coupon} />)
          )}
        </ScrollView>
      )}
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
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.white },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: 12, paddingBottom: 40 },
  redeemCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.sm,
  },
  redeemTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  redeemRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#F7F8FC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.textPrimary,
  },
  redeemBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
  },
  redeemBtnText: { color: colors.white, fontWeight: '700' },
  redeemHint: { marginTop: 8, fontSize: 12, color: colors.textSecondary },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: 8,
    ...shadows.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  code: { fontSize: 12, color: colors.textLight, fontWeight: '700' },
  title: { fontSize: typography.fontSizes.md, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  badge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  badgeText: { color: '#2E7D32', fontWeight: '700', fontSize: 12 },
  desc: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 12, color: colors.textLight },
  stackTag: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  stackOk: { backgroundColor: '#E3F2FD', color: '#1565C0' },
  stackBlock: { backgroundColor: '#FFEBEE', color: '#C62828' },
  blockedText: { fontSize: 11, color: colors.error, flexShrink: 1, textAlign: 'right' },
  emptyWrap: {
    marginTop: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  emptySub: { fontSize: typography.fontSizes.sm, color: colors.textSecondary },
});
