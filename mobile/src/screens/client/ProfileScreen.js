import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ScrollView, Alert, Image, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { uploadAPI } from '../../services/api';
import ProfileSwitcher from '../../components/ProfileSwitcher';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.15.17:3000/api').replace(/\/api\/?$/, '');

function buildImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

export default function ProfileScreen({ navigation }) {
  const { user, logout, updateUser } = useAuth();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
    { icon: 'help-circle-outline', label: 'Central de ajuda', color: '#F3E8FD', onPress: () => navigation.navigate('HelpCenter') },
    { icon: 'document-text-outline', label: 'Termos de uso', color: '#E8F5E9', onPress: () => navigation.navigate('Terms') },
    { icon: 'star-outline', label: 'Avaliar o app', color: '#FFF8E1', onPress: null },
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
            <TouchableOpacity style={styles.avatarWrap} onPress={showAvatarOptions} activeOpacity={0.85}>
              {user?.avatar ? (
                <Image source={{ uri: buildImageUrl(user.avatar) }} style={styles.avatarImage} />
              ) : (
                <LinearGradient
                  colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
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

          {/* Perfis */}
          <ProfileSwitcher navigation={navigation} />

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
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
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

