import React, { useState, useEffect, useRef } from 'react';
import {
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ActivityIndicator, View, Text, TouchableOpacity, StyleSheet,
  Modal, Image, Dimensions, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { bannerAPI } from '../services/api';

import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import ProfessionalNavigator from './ProfessionalNavigator';
import DocumentUploadScreen from '../screens/auth/DocumentUploadScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';
import AcceptTermsScreen from '../screens/auth/AcceptTermsScreen';
import ProfessionalAddressScreen from '../screens/auth/ProfessionalAddressScreen';

const Stack = createNativeStackNavigator();
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api').replace(/\/api\/?$/, '');
const buildImageUrl = (p) => !p ? null : (String(p).startsWith('http') ? p : `${API_BASE}${p}`);

// Module-level set — tracks banners already shown in this app session
const _shownBannerIds = new Set();

export default function RootNavigator() {
  const { user, loading, networkError, retryAuth } = useAuth();
  const [activeBanner, setActiveBanner] = useState(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  const bannerFetchedForUser = useRef(null);

  // Fetch active banner once per authenticated session per user
  useEffect(() => {
    if (!user || !user._id || bannerFetchedForUser.current === user._id) return;
    bannerFetchedForUser.current = user._id;
    bannerAPI.getActive()
      .then(({ data }) => {
        const banner = data?.banner;
        if (banner && !_shownBannerIds.has(banner._id)) {
          _shownBannerIds.add(banner._id);
          setActiveBanner(banner);
          setBannerVisible(true);
        }
      })
      .catch(() => {});
  }, [user?._id]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  if (networkError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="cloud-offline-outline" size={64} color={colors.textLight} />
        <Text style={styles.errorTitle}>Sem conexão</Text>
        <Text style={styles.errorSub}>Não foi possível conectar ao servidor.{'\n'}Verifique sua internet e tente novamente.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={retryAuth}>
          <Ionicons name="refresh-outline" size={18} color={colors.white} />
          <Text style={styles.retryText}>Tentar novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderMain = () => {
    if (!user) return <AuthNavigator />;
    if (!user.isEmailVerified) return <AuthNavigator />;

    // Aceite dos Termos de Uso — obrigatório antes de qualquer outra etapa
    if (!user.termsAcceptedAt) return <AcceptTermsScreen />;

    // Determina qual perfil está ativo no momento
    const activeMode = user.activeProfile || user.userType;

    // Clientes também precisam enviar selfie + documento antes de usar o app
    if (activeMode === 'client' && (!user.selfieUrl || user.verificationStatus === 'pending_documents')) {
      return <DocumentUploadScreen />;
    }

    // Cliente aguardando revisão de documentos
    if (activeMode === 'client' && (user.verificationStatus === 'pending_review' || user.verificationStatus === 'rejected')) {
      return <PendingApprovalScreen />;
    }

    // Verificação de documentos só é necessária quando o modo profissional está ativo
    if (activeMode === 'professional') {
      // 1) Endereço residencial — obrigatório antes do envio de documentos
      const hasAddress = user.professionalAddress?.city;
      if (!hasAddress) return <ProfessionalAddressScreen />;

      // 2) Envio de documentos — apenas se ainda não enviou
      if (user.verificationStatus === 'pending_documents') return <DocumentUploadScreen />;

      // 3) Aguardando revisão ou rejeitado
      if (user.verificationStatus === 'pending_review') return <PendingApprovalScreen />;
      if (user.verificationStatus === 'rejected') return <PendingApprovalScreen />;
    }

    // Navega conforme perfil ativo
    return activeMode === 'client' ? <ClientNavigator /> : <ProfessionalNavigator />;
  };

  return (
    <NavigationContainer>
      {renderMain()}
      {/* Banner de publicidade — aparece 1x por sessão por banner ativo */}
      <Modal
        visible={bannerVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setBannerVisible(false)}
      >
        <TouchableOpacity
          style={styles.bannerOverlay}
          activeOpacity={1}
          onPress={() => setBannerVisible(false)}
        >
          <SafeAreaView style={styles.bannerSafe} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.bannerClose}
              onPress={() => setBannerVisible(false)}
              hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            {activeBanner?.imageUrl ? (
              <Image
                source={{ uri: buildImageUrl(activeBanner.imageUrl) }}
                style={styles.bannerImage}
                resizeMode="contain"
              />
            ) : null}
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  errorSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 8,
  },
  retryText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  // Banner modal
  bannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerSafe: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerImage: {
    width: SCREEN_W,
    height: SCREEN_H * 0.82,
    borderRadius: 12,
  },
  bannerClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 6,
  },
});
