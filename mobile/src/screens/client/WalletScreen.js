import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { clientWalletAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const TYPE_CONFIG = {
  credit_refund: {
    icon: 'arrow-down-circle',
    color: '#43A047',
    label: 'Crédito recebido',
    sign: '+',
  },
  debit_payment: {
    icon: 'arrow-up-circle',
    color: '#E53935',
    label: 'Usado no pagamento',
    sign: '-',
  },
};

function TransactionItem({ item }) {
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.credit_refund;
  const label = item.metadata?.label || cfg.label;
  const date = new Date(item.createdAt).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <View style={styles.txItem}>
      <View style={[styles.txIcon, { backgroundColor: cfg.color + '18' }]}>
        <Ionicons name={cfg.icon} size={20} color={cfg.color} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.txDate}>{date}</Text>
      </View>
      <Text style={[styles.txAmount, { color: cfg.color }]}>
        {cfg.sign} R$ {Number(item.amount).toFixed(2).replace('.', ',')}
      </Text>
    </View>
  );
}

export default function WalletScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const walletBalance = Number(user?.clientWallet?.balance || 0);

  useEffect(() => {
    let cancelled = false;

    // Safety net: garante que o spinner nunca fica eterno se o axios travar
    const safetyTimer = setTimeout(() => setLoading(false), 12000);

    clientWalletAPI.summary()
      .then(({ data }) => {
        if (cancelled) return;
        setTransactions(data.transactions || []);
        if (data.balance !== undefined) {
          updateUser({ clientWallet: { balance: data.balance, totalRefunded: data.totalRefunded } });
        }
      })
      .catch((err) => console.warn('[Carteira] Erro ao carregar:', err?.message))
      .finally(() => {
        clearTimeout(safetyTimer);
        setLoading(false); // sempre limpa, independente de cancelled
      });

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Carteira de Créditos</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              <LinearGradient
                colors={colors.gradientSuccess}
                style={styles.balanceCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={styles.balanceRow}>
                  <View style={styles.balanceIconWrap}>
                    <Ionicons name="wallet" size={20} color="rgba(255,255,255,0.9)" />
                  </View>
                  <Text style={styles.balanceLabel}>SALDO DISPONÍVEL</Text>
                </View>
                <Text style={styles.balanceAmount}>
                  R$ {walletBalance.toFixed(2).replace('.', ',')}
                </Text>
                <Text style={styles.balanceSub}>
                  Créditos gerados por estornos e reembolsos
                </Text>
              </LinearGradient>

              {transactions.length > 0 && (
                <Text style={styles.sectionTitle}>Histórico de movimentações</Text>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={52} color={colors.textLight} />
              <Text style={styles.emptyTitle}>Sem movimentações</Text>
              <Text style={styles.emptyText}>
                Seus créditos de estorno e reembolso aparecerão aqui.
              </Text>
            </View>
          }
          renderItem={({ item }) => <TransactionItem item={item} />}
        />
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
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: typography.fontSizes.lg, fontWeight: '700', color: colors.white },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.lg, gap: 16, paddingBottom: 40 },
  balanceCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: 6,
    marginBottom: 4,
    ...shadows.md,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  balanceIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  balanceLabel: {
    fontSize: 11, fontWeight: '700',
    color: 'rgba(255,255,255,0.85)', letterSpacing: 0.8,
  },
  balanceAmount: {
    fontSize: 34, fontWeight: '800',
    color: colors.white, letterSpacing: -0.5,
  },
  balanceSub: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.7)', fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '600',
    color: colors.textSecondary, marginTop: 8,
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.sm,
  },
  txIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  txInfo: { flex: 1 },
  txLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  txDate: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  emptyState: {
    alignItems: 'center', paddingHorizontal: spacing.xl,
    gap: 12, paddingTop: 40,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
