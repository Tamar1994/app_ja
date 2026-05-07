import React from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar' },
      { text: 'Sair', style: 'destructive', onPress: logout },
    ]);
  };

  const menuItems = [
    { icon: 'shield-checkmark-outline', label: 'Segurança e privacidade', color: '#E8F0FE' },
    { icon: 'help-circle-outline', label: 'Central de ajuda', color: '#F3E8FD' },
    { icon: 'document-text-outline', label: 'Termos de uso', color: '#E8F5E9' },
    { icon: 'star-outline', label: 'Avaliar o app', color: '#FFF8E1' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header com gradiente */}
        <LinearGradient
          colors={colors.gradientPrimary}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.headerTitle}>Perfil</Text>
          <View style={styles.profileSection}>
            <View style={styles.avatarWrap}>
              <LinearGradient
                colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>{user.name[0].toUpperCase()}</Text>
              </LinearGradient>
            </View>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={styles.typeBadge}>
              <Ionicons name="home-outline" size={12} color={colors.white} />
              <Text style={styles.typeBadgeText}>Cliente</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.content}>
          {/* Info card */}
          <View style={styles.infoCard}>
            {[
              { icon: 'call-outline', label: 'Telefone', value: user.phone || 'Não informado' },
              { icon: 'mail-outline', label: 'E-mail', value: user.email },
            ].map((item, i) => (
              <View key={i} style={[styles.infoRow, i === 0 && styles.infoRowBorder]}>
                <View style={styles.infoIcon}>
                  <Ionicons name={item.icon} size={18} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.infoLabel}>{item.label}</Text>
                  <Text style={styles.infoValue}>{item.value}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Menu */}
          <View style={styles.menuCard}>
            {menuItems.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.menuRow, i < menuItems.length - 1 && styles.menuRowBorder]}
                activeOpacity={0.7}
              >
                <View style={[styles.menuIcon, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Botão sair */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <Text style={styles.logoutText}>Sair da conta</Text>
          </TouchableOpacity>

          <Text style={styles.version}>Já! v1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 55,
    paddingBottom: 30,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  headerTitle: {
    alignSelf: 'flex-start',
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: colors.white,
    marginBottom: spacing.lg,
  },
  profileSection: { alignItems: 'center', gap: 6 },
  avatarWrap: { marginBottom: 4 },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { color: colors.white, fontSize: 38, fontWeight: '700' },
  userName: { fontSize: typography.fontSizes.xl, fontWeight: '800', color: colors.white },
  userEmail: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.8)' },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },
  typeBadgeText: { color: colors.white, fontWeight: '600', fontSize: typography.fontSizes.sm },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 80,
    marginTop: -10,
  },
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    ...shadows.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 16,
  },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF0E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: { fontSize: typography.fontSizes.xs, color: colors.textLight, fontWeight: '500' },
  infoValue: { fontSize: typography.fontSizes.md, color: colors.textPrimary, fontWeight: '600', marginTop: 1 },
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    ...shadows.md,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 16,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { fontSize: typography.fontSizes.md, color: colors.textPrimary, fontWeight: '500' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: colors.error + '40',
    borderRadius: borderRadius.full,
    backgroundColor: colors.error + '08',
  },
  logoutText: { color: colors.error, fontWeight: '700', fontSize: typography.fontSizes.md },
  version: { textAlign: 'center', fontSize: typography.fontSizes.sm, color: colors.textLight },
});

