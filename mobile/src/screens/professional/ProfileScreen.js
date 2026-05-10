import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, Alert, Image, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { uploadAPI, userAPI } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.15.17:3000/api').replace(/\/api\/?$/, '');
const fmt = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

function buildImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

export default function ProfessionalProfileScreen({ navigation }) {
  const { user, logout, updateUser } = useAuth();
  const { emit } = useSocket();
  const [available, setAvailable] = useState(user?.professional?.isAvailable || false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const toggleAvailability = async (val) => {
    setAvailable(val);
    try {
      await userAPI.setAvailability(val);
      emit('toggle_availability', { isAvailable: val });
      updateUser({ professional: { ...user.professional, isAvailable: val } });
    } catch {
      setAvailable(!val);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar' },
      { text: 'Sair', style: 'destructive', onPress: logout },
    ]);
  };

  const uploadAvatarAsset = async (asset) => {
    if (!asset?.uri) return;
    setUploadingAvatar(true);
    try {
      const ext = asset.uri.split('.').pop()?.toLowerCase();
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
      const formData = new FormData();
      formData.append('avatar', {
        uri: asset.uri,
        name: `avatar.${safeExt}`,
        type: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
      });

      const { data } = await uploadAPI.avatar(formData);
      if (data?.avatarUrl) {
        updateUser({ avatar: data.avatarUrl });
      }
      Alert.alert('Sucesso', 'Foto de perfil atualizada!');
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Nao foi possivel atualizar a foto.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissao necessaria', 'Precisamos de acesso a sua galeria.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]) {
      await uploadAvatarAsset(result.assets[0]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissao necessaria', 'Precisamos de acesso a camera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets?.[0]) {
      await uploadAvatarAsset(result.assets[0]);
    }
  };

  const showAvatarOptions = () => {
    if (uploadingAvatar) return;
    Alert.alert('Foto de perfil', 'Como deseja alterar sua foto?', [
      { text: 'Camera', onPress: takePhoto },
      { text: 'Galeria', onPress: pickFromGallery },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const menuItems = [
    { icon: 'shield-checkmark-outline', label: 'Segurança e privacidade', color: '#E8F0FE', onPress: () => navigation.navigate('Security') },
    { icon: 'ticket-outline', label: 'Carteira de cupons', color: '#E8F5E9', onPress: () => navigation.navigate('CouponWallet') },
    { icon: 'chatbubble-ellipses-outline', label: 'Falar com suporte', color: '#E3F2FD', onPress: () => navigation.navigate('SupportChat') },
    { icon: 'help-circle-outline', label: 'Central de ajuda', color: '#F3E8FD', onPress: () => navigation.navigate('HelpCenter') },
    { icon: 'document-text-outline', label: 'Termos de uso', color: '#E8F5E9', onPress: () => navigation.navigate('Terms') },
    { icon: 'star-outline', label: 'Avaliar o app', color: '#FFF8E1', onPress: null },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header azul */}
        <LinearGradient
          colors={colors.gradientSecondary}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.headerTitle}>Perfil</Text>
          <View style={styles.profileSection}>
            <TouchableOpacity onPress={showAvatarOptions} activeOpacity={0.85}>
              {user.avatar ? (
                <Image
                  source={{ uri: buildImageUrl(user.avatar) }}
                  style={styles.avatarImg}
                />
              ) : (
                <LinearGradient
                  colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>{user.name[0].toUpperCase()}</Text>
                </LinearGradient>
              )}
              <View style={styles.avatarEditBadge}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={styles.typeBadge}>
              <Ionicons name="briefcase-outline" size={12} color={colors.white} />
              <Text style={styles.typeBadgeText}>Profissional · Diarista</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { icon: 'star', value: user.professional?.rating?.toFixed(1) || '—', label: 'Avaliação', color: colors.warning },
              { icon: 'checkmark-circle', value: user.professional?.totalServicesCompleted || 0, label: 'Serviços', color: colors.success },
              { icon: 'cash-outline', value: `R$${user.professional?.pricePerHour || 35}/h`, label: 'Valor', color: '#90CAF9' },
            ].map((s, i) => (
              <View key={i} style={styles.statCard}>
                <Ionicons name={s.icon} size={18} color={s.color} />
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={styles.content}>
          {/* Card de carteira */}
          <LinearGradient colors={['#FF8C38', '#FF6B00']} style={styles.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={styles.walletRow}>
              <View>
                <Text style={styles.walletLabel}>Saldo disponível</Text>
                <Text style={styles.walletBalance}>{fmt(user.wallet?.balance)}</Text>
              </View>
              <View style={styles.walletIconBox}>
                <Ionicons name="wallet" size={24} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
            <View style={styles.walletDivider} />
            <View style={styles.walletStats}>
              <View>
                <Text style={styles.walletStatLabel}>Total ganho</Text>
                <Text style={styles.walletStatValue}>{fmt(user.wallet?.totalEarned)}</Text>
              </View>
              <View>
                <Text style={styles.walletStatLabel}>Serviços</Text>
                <Text style={styles.walletStatValue}>{user.professional?.totalServicesCompleted || 0}</Text>
              </View>
            </View>
          </LinearGradient>

          {/* Disponibilidade */}
          <TouchableOpacity
            style={[styles.availCard, available && styles.availCardActive]}
            onPress={() => toggleAvailability(!available)}
            activeOpacity={0.8}
          >
            <View style={[styles.availDot, available && styles.availDotActive]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.availTitle}>{available ? 'Você está online' : 'Você está offline'}</Text>
              <Text style={styles.availSub}>
                {available ? 'Recebendo pedidos de serviço' : 'Toque para ficar disponível'}
              </Text>
            </View>
            <View style={[styles.availToggle, available && styles.availToggleActive]}>
              <Text style={[styles.availToggleText, available && styles.availToggleTextActive]}>
                {available ? 'Online' : 'Offline'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Info */}
          <View style={styles.infoCard}>
            {[
              { icon: 'call-outline', label: 'Telefone', value: user.phone || 'Não informado' },
              { icon: 'mail-outline', label: 'E-mail', value: user.email },
              {
                icon: user.professional?.documentsVerified ? 'shield-checkmark' : 'shield-outline',
                label: 'Documentos',
                value: user.professional?.documentsVerified ? 'Verificado ✓' : 'Pendente',
                highlight: user.professional?.documentsVerified,
              },
            ].map((item, i) => (
              <View key={i} style={[styles.infoRow, i < 2 && styles.infoRowBorder]}>
                <View style={[styles.infoIcon, item.highlight && { backgroundColor: `${colors.success}15` }]}>
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={item.highlight ? colors.success : colors.secondary}
                  />
                </View>
                <View>
                  <Text style={styles.infoLabel}>{item.label}</Text>
                  <Text style={[styles.infoValue, item.highlight && { color: colors.success }]}>
                    {item.value}
                  </Text>
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
                onPress={item.onPress || undefined}
              >
                <View style={[styles.menuIcon, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            ))}
          </View>

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
    paddingBottom: 24,
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
  profileSection: { alignItems: 'center', gap: 6, marginBottom: spacing.lg },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
  },
  avatarImg: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  typeBadgeText: { color: colors.white, fontWeight: '600', fontSize: typography.fontSizes.sm },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.lg,
    padding: 12,
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  statValue: { fontSize: typography.fontSizes.lg, fontWeight: '800', color: colors.white },
  statLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 80,
    marginTop: -10,
  },
  availCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    ...shadows.md,
  },
  availCardActive: {
    borderColor: colors.success,
    backgroundColor: `${colors.success}05`,
  },
  availDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.textLight,
  },
  availDotActive: { backgroundColor: colors.success },
  availTitle: { fontSize: typography.fontSizes.md, fontWeight: '700', color: colors.textPrimary },
  availSub: { fontSize: typography.fontSizes.sm, color: colors.textSecondary, marginTop: 2 },
  availToggle: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  availToggleActive: { backgroundColor: `${colors.success}15`, borderColor: colors.success },
  availToggleText: { fontSize: typography.fontSizes.sm, color: colors.textLight, fontWeight: '600' },
  availToggleTextActive: { color: colors.success },
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
    backgroundColor: `${colors.secondary}12`,
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
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
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
  walletCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  walletRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginBottom: 4 },
  walletBalance: { color: '#fff', fontSize: 28, fontWeight: '800' },
  walletIconBox: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  walletDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 14 },
  walletStats: { flexDirection: 'row', justifyContent: 'space-between' },
  walletStatLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  walletStatValue: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 2 },
});

