import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  Alert, Modal, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { walletAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const PERIODS = [
  { key: 'day', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
];

const WEEK_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const fmt = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const fmtDatetime = (v) => new Date(v).toLocaleDateString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function EarningsScreen() {
  const [period, setPeriod] = useState('week');
  const [summary, setSummary] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('50');
  const [requestingWithdrawal, setRequestingWithdrawal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, e, w] = await Promise.all([
        walletAPI.summary(),
        walletAPI.earnings(period),
        walletAPI.myWithdrawals(),
      ]);
      setSummary(s.data);
      setEarnings(e.data);
      setWithdrawals(w.data.withdrawals || []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [period]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const getBarData = () => {
    if (!earnings?.grouped?.length) return [];
    const max = Math.max(...earnings.grouped.map((g) => g.total), 1);

    if (period === 'week') {
      const days = WEEK_LABELS.map((label, i) => {
        const key = String(i + 1).padStart(2, '0');
        const found = earnings.grouped.find((g) => g._id === String(i + 1) || g._id === key);
        return { label, value: found?.value || 0, total: found?.total || 0 };
      });
      const maxVal = Math.max(...days.map((d) => d.total), 1);
      return days.map((d) => ({ ...d, pct: d.total / maxVal }));
    }

    if (period === 'month') {
      const today = new Date().getDate();
      const bars = [];
      for (let d = 1; d <= today; d++) {
        const key = String(d).padStart(2, '0');
        const found = earnings.grouped.find((g) => g._id === key);
        bars.push({ label: String(d), total: found?.total || 0 });
      }
      const maxVal = Math.max(...bars.map((b) => b.total), 1);
      return bars.map((b) => ({ ...b, pct: b.total / maxVal }));
    }

    if (period === 'year') {
      return MONTH_LABELS.map((label, i) => {
        const key = String(i + 1).padStart(2, '0');
        const found = earnings.grouped.find((g) => g._id === key);
        const total = found?.total || 0;
        return { label, total, pct: total / Math.max(...earnings.grouped.map((g) => g.total), 1) };
      });
    }

    // day — por hora
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0');
      const found = earnings.grouped.find((g) => g._id === key);
      const total = found?.total || 0;
      hours.push({ label: `${h}h`, total, pct: total / max });
    }
    return hours.filter((h, i) => i % 2 === 0); // a cada 2h para caber
  };

  const bars = getBarData();
  const hasData = bars.some((b) => b.total > 0);

  const handleOpenWithdrawal = () => {
    setWithdrawAmount(String(summary?.withdrawalRules?.minAmount || 50));
    setWithdrawModalVisible(true);
  };

  const handleRequestWithdrawal = async () => {
    const amount = Number(withdrawAmount.replace(',', '.'));
    const minAmount = Number(summary?.withdrawalRules?.minAmount || 50);

    if (!Number.isFinite(amount) || amount < minAmount) {
      Alert.alert('Valor inválido', `O saque mínimo é ${fmt(minAmount)}.`);
      return;
    }

    setRequestingWithdrawal(true);
    try {
      const { data } = await walletAPI.requestWithdrawal(amount);
      Alert.alert('Saque solicitado', data?.message || 'Solicitação registrada com sucesso.');
      setWithdrawModalVisible(false);
      load();
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível solicitar saque agora.');
    } finally {
      setRequestingWithdrawal(false);
    }
  };

  const withdrawalStatusLabel = (status) => ({
    pending: 'Na fila',
    processing: 'Em processamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  }[status] || status);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <LinearGradient colors={['#FF8C38', '#FF6B00']} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Text style={styles.headerTitle}>Carteira</Text>
          {summary ? (
            <>
              <Text style={styles.balanceLabel}>Saldo disponível</Text>
              <Text style={styles.balanceValue}>{fmt(summary.balance)}</Text>
              <View style={styles.headerStats}>
                <View style={styles.headerStat}>
                  <Ionicons name="trending-up-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.headerStatValue}>{fmt(summary.totalEarned)}</Text>
                  <Text style={styles.headerStatLabel}>Total ganho</Text>
                </View>
                <View style={styles.headerStatDivider} />
                <View style={styles.headerStat}>
                  <Ionicons name="checkmark-circle-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.headerStatValue}>{summary.totalServices}</Text>
                  <Text style={styles.headerStatLabel}>Serviços</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.withdrawBtn, !summary.canRequestWithdrawal && styles.withdrawBtnDisabled]}
                onPress={handleOpenWithdrawal}
                disabled={!summary.canRequestWithdrawal}
              >
                <Ionicons name="cash-outline" size={18} color="#FF6B00" />
                <Text style={styles.withdrawBtnText}>Solicitar saque PIX</Text>
              </TouchableOpacity>
              {!summary.canRequestWithdrawal && summary.nextWithdrawalAt && (
                <Text style={styles.withdrawHint}>
                  Próxima solicitação disponível em {new Date(summary.nextWithdrawalAt).toLocaleString('pt-BR')}
                </Text>
              )}
            </>
          ) : (
            <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
          )}
        </LinearGradient>

        {/* Filtro de período */}
        <View style={styles.periodBar}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodBtn, period === p.key && styles.periodBtnActive]}
              onPress={() => setPeriod(p.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.periodBtnText, period === p.key && styles.periodBtnTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Cards do período */}
            {earnings && (
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>{fmt(earnings.total)}</Text>
                  <Text style={styles.statCardLabel}>Ganhos</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>{earnings.count}</Text>
                  <Text style={styles.statCardLabel}>Serviços</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>{fmt(earnings.avg)}</Text>
                  <Text style={styles.statCardLabel}>Média</Text>
                </View>
              </View>
            )}

            {/* Gráfico de barras */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>
                {period === 'day' ? 'Por hora' : period === 'week' ? 'Por dia' : period === 'month' ? 'Por dia do mês' : 'Por mês'}
              </Text>
              {!hasData ? (
                <View style={styles.emptyChart}>
                  <Ionicons name="bar-chart-outline" size={40} color={colors.border} />
                  <Text style={styles.emptyChartText}>Nenhum ganho nesse período</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barsContainer}>
                  {bars.map((bar, i) => (
                    <View key={i} style={styles.barWrapper}>
                      <View style={styles.barTrack}>
                        <LinearGradient
                          colors={bar.pct > 0 ? ['#FF8C38', '#FF6B00'] : ['#EDF0F5', '#EDF0F5']}
                          style={[styles.barFill, { height: Math.max(bar.pct * 120, bar.pct > 0 ? 4 : 0) }]}
                          start={{ x: 0, y: 1 }}
                          end={{ x: 0, y: 0 }}
                        />
                      </View>
                      <Text style={styles.barLabel} numberOfLines={1}>{bar.label}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Histórico de transações */}
            {summary?.transactions?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Últimas transações</Text>
                {summary.transactions.map((t) => (
                  <View key={t._id} style={styles.transactionRow}>
                    <View style={[styles.transactionIcon, { backgroundColor: t.type === 'withdrawal' ? '#FDECEC' : '#E8F5E9' }]}>
                      <Ionicons
                        name={t.type === 'withdrawal' ? 'arrow-up-circle' : 'arrow-down-circle'}
                        size={20}
                        color={t.type === 'withdrawal' ? '#E53935' : colors.success}
                      />
                    </View>
                    <View style={styles.transactionInfo}>
                      <Text style={styles.transactionDesc}>{t.description || (t.type === 'withdrawal' ? 'Saque solicitado' : 'Serviço concluído')}</Text>
                      <Text style={styles.transactionDate}>
                        {new Date(t.createdAt).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <Text style={[styles.transactionAmount, t.type === 'withdrawal' && styles.transactionAmountDebit]}>
                      {t.type === 'withdrawal' ? '-' : '+'}{fmt(t.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {withdrawals?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Últimos saques</Text>
                {withdrawals.slice(0, 6).map((w) => (
                  <View key={w._id} style={styles.withdrawRow}>
                    <View>
                      <Text style={styles.withdrawAmount}>{fmt(w.amount)}</Text>
                      <Text style={styles.withdrawDate}>{fmtDatetime(w.requestedAt)}</Text>
                    </View>
                    <Text style={styles.withdrawStatus}>{withdrawalStatusLabel(w.status)}</Text>
                  </View>
                ))}
              </View>
            )}

            {!summary?.transactions?.length && !loading && (
              <View style={styles.emptySection}>
                <Ionicons name="wallet-outline" size={48} color={colors.border} />
                <Text style={styles.emptyText}>Nenhuma transação ainda</Text>
                <Text style={styles.emptySubtext}>Conclua serviços para ver seus ganhos aqui</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={withdrawModalVisible} transparent animationType="slide" onRequestClose={() => setWithdrawModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Solicitar saque</Text>
            <Text style={styles.modalText}>O saque será realizado via PIX na chave CPF do seu cadastro.</Text>
            <Text style={styles.modalText}>O processamento é manual e pode levar até 24 horas.</Text>
            <Text style={styles.modalText}>Regras: mínimo de {fmt(summary?.withdrawalRules?.minAmount || 50)} e 1 solicitação por semana.</Text>

            <Text style={styles.modalLabel}>Valor do saque</Text>
            <TextInput
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
              keyboardType="decimal-pad"
              placeholder="50,00"
              style={styles.modalInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnGhost} onPress={() => setWithdrawModalVisible(false)}>
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnPrimary, requestingWithdrawal && { opacity: 0.7 }]}
                onPress={handleRequestWithdrawal}
                disabled={requestingWithdrawal}
              >
                {requestingWithdrawal
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalBtnPrimaryText}>Confirmar saque</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 56,
    paddingBottom: 32,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  headerTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginBottom: 4 },
  balanceValue: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: -1 },
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 24,
  },
  headerStat: { alignItems: 'center', gap: 2 },
  headerStatValue: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerStatLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  headerStatDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.3)' },
  withdrawBtn: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  withdrawBtnDisabled: { opacity: 0.5 },
  withdrawBtnText: { color: '#FF6B00', fontWeight: '700', fontSize: 13 },
  withdrawHint: { marginTop: 8, color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center' },
  periodBar: {
    flexDirection: 'row',
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: 4,
    ...shadows.sm,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  periodBtnActive: { backgroundColor: colors.primary },
  periodBtnText: { fontSize: 13, fontWeight: '600', color: colors.textLight },
  periodBtnTextActive: { color: '#fff' },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    ...shadows.sm,
  },
  statCardValue: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  statCardLabel: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  chartCard: {
    margin: spacing.md,
    marginTop: 0,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  chartTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 16 },
  barsContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingBottom: 4 },
  barWrapper: { alignItems: 'center', width: 32 },
  barTrack: {
    width: 20,
    height: 120,
    justifyContent: 'flex-end',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  barFill: { width: '100%', borderRadius: 4 },
  barLabel: { fontSize: 9, color: colors.textLight, marginTop: 4, textAlign: 'center' },
  emptyChart: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyChartText: { color: colors.textLight, fontSize: 13 },
  section: { margin: spacing.md, marginTop: 0 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    ...shadows.sm,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionInfo: { flex: 1 },
  transactionDesc: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  transactionDate: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  transactionAmount: { fontSize: 15, fontWeight: '700', color: colors.success },
  transactionAmountDebit: { color: '#E53935' },
  withdrawRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  withdrawAmount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  withdrawDate: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  withdrawStatus: { fontSize: 12, fontWeight: '700', color: '#5C6B7A' },
  emptySection: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  emptySubtext: { fontSize: 13, color: colors.textLight, textAlign: 'center', paddingHorizontal: spacing.xl },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: spacing.lg,
    gap: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  modalText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  modalLabel: { marginTop: 6, fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  modalBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalBtnGhostText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  modalBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FF6B00',
    minWidth: 130,
    alignItems: 'center',
  },
  modalBtnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
