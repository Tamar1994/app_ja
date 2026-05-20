import React, { useState, useEffect, useRef } from 'react';
import {
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ActivityIndicator, View, Text, TouchableOpacity, StyleSheet,
  Modal, Image, Dimensions, SafeAreaView, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { bannerAPI, requestAPI } from '../services/api';

import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import ProfessionalNavigator from './ProfessionalNavigator';
import DocumentUploadScreen from '../screens/auth/DocumentUploadScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';
import AcceptTermsScreen from '../screens/auth/AcceptTermsScreen';
import ProfessionalAddressScreen from '../screens/auth/ProfessionalAddressScreen';
import RegionUnavailableScreen from '../screens/auth/RegionUnavailableScreen';

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

  // ── Verificação de cobertura regional ──────────────────────────────
  // 'checking' enquanto obtém localização | 'ok' = cidade atendida | 'blocked' = não atendida
  const [regionState, setRegionState]   = useState('checking');
  const [blockedCity, setBlockedCity]   = useState('');
  const [blockedStateUF, setBlockedStateUF] = useState('');
  const [blockedCoords, setBlockedCoords]   = useState(null);
  const appStateRef = useRef(AppState.currentState);
  // Guard: impede chamadas concorrentes (causa o loop de resume/pause que destrói o app)
  const isCheckingCoverageRef = useRef(false);

  // Verifica na abertura inicial
  useEffect(() => {
    checkRegionCoverage();
  }, []);

  // Re-verifica quando o app volta ao primeiro plano — mas SEM mostrar diálogo de permissão
  // (requestForegroundPermissionsAsync exibe um diálogo que causa AppState inactive→active,
  //  disparando este listener novamente e criando um loop infinito que destrói o app)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        // Só re-verifica se a permissão já foi concedida anteriormente (sem mostrar diálogo)
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          checkRegionCoverage();
        }
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  const CACHE_KEY = '@regionCheck_v1';
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas

  const checkRegionCoverage = async () => {
    // Impede execução concorrente — sem este guard, múltiplas chamadas simultâneas
    // causam um loop de onHostResume/onHostPause que destrói a surface do React Native
    if (isCheckingCoverageRef.current) return;
    isCheckingCoverageRef.current = true;
    try {
      // 1. Solicita permissão de localização
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Sem permissão → não bloqueia (verificação ocorre no endereço depois)
        setRegionState('ok');
        return;
      }

      // 2. Obtém posição atual (precisão de cidade é suficiente — Low é mais rápido)
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });
      const { latitude, longitude } = position.coords;

      // 3. Geocodificação reversa para obter cidade/estado
      const [geocode] = await Location.reverseGeocodeAsync({ latitude, longitude });
      const city     = geocode?.city || geocode?.subregion || '';
      const stateUF  = geocode?.region || '';

      if (!city) {
        // Sem cidade identificável → não bloqueia
        setRegionState('ok');
        return;
      }

      // 4. Verifica cache local — só aproveita se a cidade atual bater com a cidade em cache
      //    Isso garante que mudar de cidade invalida automaticamente o resultado cacheado.
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const { result, city: cachedCity, stateUF: cachedStateUF, timestamp } = JSON.parse(cached);
        if (
          Date.now() - timestamp < CACHE_TTL &&
          cachedCity === city &&
          cachedStateUF === stateUF
        ) {
          setBlockedCity(city);
          setBlockedStateUF(stateUF);
          setRegionState(result); // 'ok' ou 'blocked'
          return;
        }
      }

      // 5. Verifica cobertura no backend — falha rápida se offline
      let coverageData;
      try {
        const res = await requestAPI.checkCoverage(city, stateUF);
        coverageData = res.data;
      } catch {
        // Erro de rede ou backend indisponível → não bloqueia o usuário
        setRegionState('ok');
        return;
      }
      const result = coverageData.covered ? 'ok' : 'blocked';

      setBlockedCity(city);
      setBlockedStateUF(stateUF);
      if (result === 'blocked') setBlockedCoords([longitude, latitude]);

      // 6. Persiste cache com a cidade atual
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        result, city, stateUF, timestamp: Date.now(),
      }));

      // 7. Se não atendida, registra interesse anonimamente (sem e-mail)
      if (result === 'blocked') {
        requestAPI.registerInterest({
          city,
          state: stateUF,
          coordinates: [longitude, latitude],
        }).catch(() => {});
      }

      setRegionState(result);
    } catch {
      // Qualquer erro (sem rede, timeout, etc.) → não bloqueia
      setRegionState('ok');
    } finally {
      isCheckingCoverageRef.current = false;
    }
  };
  // ──────────────────────────────────────────────────────────────────

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

  if (loading || regionState === 'checking') {
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

  if (regionState === 'blocked') {
    return (
      <RegionUnavailableScreen
        city={blockedCity}
        state={blockedStateUF}
        coordinates={blockedCoords}
      />
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
