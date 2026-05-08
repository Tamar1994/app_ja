import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  SafeAreaView, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { paymentAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const BRAND_COLORS = {
  visa: ['#1A1F71', '#2B3A9F'],
  mastercard: ['#EB001B', '#F79E1B'],
  amex: ['#007BC1', '#005A8E'],
  discover: ['#FF6600', '#FF8C00'],
  elo: ['#00A650', '#007A3D'],
  hipercard: ['#CC1B28', '#A0121E'],
};

const BRAND_NAMES = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express',
  discover: 'Discover', elo: 'Elo', hipercard: 'Hipercard',
};

function CardItem({ method, onDelete, onSetDefault, deleting, settingDefault }) {
  const brandColors = BRAND_COLORS[method.brand] || ['#555', '#333'];
  const brandName = BRAND_NAMES[method.brand] || method.brand;

  return (
    <LinearGradient colors={brandColors} style={styles.cardItem} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={styles.cardTop}>
        <View>
          {method.isDefault && (
            <View style={styles.defaultBadge}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={styles.defaultBadgeText}>Padrão</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          {!method.isDefault && (
            <TouchableOpacity
              style={styles.cardActionBtn}
              onPress={() => onSetDefault(method.id)}
              disabled={settingDefault}
            >
              {settingDefault
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="star-outline" size={18} color="rgba(255,255,255,0.8)" />}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.cardActionBtn}
            onPress={() => onDelete(method.id)}
            disabled={deleting}
          >
            {deleting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.8)" />}
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.cardNumber}>•••• •••• •••• {method.last4}</Text>
      <View style={styles.cardBottom}>
        <View>
          <Text style={styles.cardLabel}>Validade</Text>
          <Text style={styles.cardValue}>{String(method.expMonth).padStart(2, '0')}/{method.expYear}</Text>
        </View>
        <Text style={styles.cardBrand}>{brandName}</Text>
      </View>
    </LinearGradient>
  );
}

export default function WalletScreen({ navigation }) {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [settingDefaultId, setSettingDefaultId] = useState(null);

  const loadMethods = async () => {
    try {
      setLoading(true);
      const { data } = await paymentAPI.getMethods();
      setMethods(data.methods || []);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar seus cartões.');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { loadMethods(); }, []));

  const handleDelete = (id) => {
    Alert.alert(
      'Remover cartão',
      'Tem certeza que deseja remover este cartão?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover', style: 'destructive',
          onPress: async () => {
            setDeletingId(id);
            try {
              await paymentAPI.deleteMethod(id);
              setMethods((prev) => prev.filter((m) => m.id !== id));
            } catch {
              Alert.alert('Erro', 'Não foi possível remover o cartão.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleSetDefault = async (id) => {
    setSettingDefaultId(id);
    try {
      await paymentAPI.setDefaultMethod(id);
      setMethods((prev) => prev.map((m) => ({ ...m, isDefault: m.id === id })));
    } catch {
      Alert.alert('Erro', 'Não foi possível atualizar o cartão padrão.');
    } finally {
      setSettingDefaultId(null);
    }
  };

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
        <Text style={styles.headerTitle}>Carteira</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : methods.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="wallet-outline" size={64} color={colors.textLight} />
          <Text style={styles.emptyTitle}>Nenhum cartão salvo</Text>
          <Text style={styles.emptyText}>
            Seus cartões são salvos automaticamente ao fazer o primeiro pagamento.
          </Text>
        </View>
      ) : (
        <FlatList
          data={methods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CardItem
              method={item}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              deleting={deletingId === item.id}
              settingDefault={settingDefaultId === item.id}
            />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>
              {methods.length} {methods.length === 1 ? 'cartão salvo' : 'cartões salvos'}
            </Text>
          }
        />
      )}

      {/* Info sobre segurança */}
      <View style={styles.secureFooter}>
        <Ionicons name="lock-closed" size={14} color={colors.textLight} />
        <Text style={styles.secureText}>
          Dados armazenados com segurança pela Stripe. Nunca guardamos seu número de cartão.
        </Text>
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
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list: { padding: spacing.lg, gap: 16 },
  sectionTitle: {
    fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 4,
  },
  cardItem: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: 16,
    minHeight: 170,
    justifyContent: 'space-between',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
  },
  defaultBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  cardActions: { flexDirection: 'row', gap: 8 },
  cardActionBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardNumber: {
    fontSize: 20, fontWeight: '700', color: '#fff',
    letterSpacing: 3, fontVariant: ['tabular-nums'],
  },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  cardValue: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardBrand: { fontSize: 18, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  secureFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.lg, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  secureText: { fontSize: 12, color: colors.textLight, flex: 1, lineHeight: 17 },
});
