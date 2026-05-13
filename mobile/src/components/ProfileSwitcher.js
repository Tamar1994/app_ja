import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { userAPI } from '../services/api';
import { colors, typography, spacing, borderRadius } from '../theme';

/**
 * ProfileSwitcher
 * Lógica de perfis:
 * - Cliente ativando profissional: endereço → ProfessionalUpgradeScreen (comprovante)
 *   → aguarda aprovação (botão desabilitado com status "Aguardando")
 * - Profissional adicionando cliente: automático, sem docs extras
 * - Switch entre perfis existentes: instantâneo via API
 */
export default function ProfileSwitcher({ onSwitch, navigation }) {
  const { user, setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const hasClient = Boolean(user?.profileModes?.client || user?.userType === 'client');
  const hasProfessional = Boolean(user?.profileModes?.professional || user?.userType === 'professional');
  const active = user?.activeProfile || user?.userType;

  // Estado da verificação profissional para clientes que querem ativar perfil pro
  const pvStatus = user?.professionalVerification?.status || 'not_started';
  const pvRejectionType = user?.professionalVerification?.rejectionType;

  const switchTo = async (profile) => {
    if (profile === active) return;
    // Não permite mudar para professional se professionalVerification não estiver approved
    if (profile === 'professional' && user?.userType === 'client') {
      if (pvStatus !== 'approved') return;
    }
    setLoading(true);
    try {
      const { data } = await userAPI.switchProfile(profile);
      setUser(data.user);
      if (onSwitch) onSwitch(data.user);
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível alternar perfil.');
    } finally {
      setLoading(false);
    }
  };

  const startProfessionalUpgrade = () => {
    // Verifica se endereço já foi preenchido
    const hasAddress = Boolean(user?.professionalAddress?.city);
    if (hasAddress) {
      navigation?.navigate('ProfessionalUpgrade');
    } else {
      navigation?.navigate('ProfessionalAddress', { upgradeMode: true });
    }
  };

  const enableClientProfile = async () => {
    Alert.alert(
      'Criar perfil cliente',
      'Isso criará um perfil de cliente nesta conta. Deseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Criar',
          onPress: async () => {
            setLoading(true);
            try {
              await userAPI.enableProfile('client');
              const { data } = await userAPI.getMe();
              setUser(data.user);
              Alert.alert('Perfil criado', 'Seu perfil de cliente foi ativado!');
            } catch (err) {
              Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível criar o perfil.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Renderiza o botão/chip do perfil profissional para clientes que ainda não têm
  const renderProfessionalUpgradeButton = () => {
    // Rejeição total — banido
    if (pvStatus === 'rejected' && pvRejectionType === 'full') {
      return (
        <View style={[styles.profileChipAdd, styles.profileChipDisabled]}>
          <Ionicons name="ban-outline" size={18} color="#888" />
          <Text style={[styles.profileChipAddText, { color: '#888' }]}>Acesso negado</Text>
        </View>
      );
    }

    // Rejeição parcial ou reenvio solicitado
    if (pvStatus === 'rejected' || pvStatus === 'resubmit_requested') {
      return (
        <TouchableOpacity
          style={[styles.profileChipAdd, { borderColor: '#FFA500' }]}
          onPress={startProfessionalUpgrade}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh-circle-outline" size={18} color="#FFA500" />
          <Text style={[styles.profileChipAddText, { color: '#FFA500' }]}>Reenviar docs</Text>
        </TouchableOpacity>
      );
    }

    // Aguardando aprovação
    if (pvStatus === 'pending_review') {
      return (
        <View style={[styles.profileChipAdd, styles.profileChipPending]}>
          <Ionicons name="time-outline" size={18} color="#FFA500" />
          <View>
            <Text style={[styles.profileChipAddText, { color: '#FFA500', fontSize: 11 }]}>Profissional</Text>
            <Text style={{ fontSize: 9, color: '#888' }}>Aguardando (24h)</Text>
          </View>
        </View>
      );
    }

    // not_started ou approved (approved = já habilitado, não chega aqui pois hasProfessional=true)
    return (
      <TouchableOpacity
        style={styles.profileChipAdd}
        onPress={startProfessionalUpgrade}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.secondary} />
        <Text style={[styles.profileChipAddText, { color: colors.secondary }]}>Ser profissional</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Perfis</Text>
      <Text style={styles.subtitle}>Alternar entre perfil de cliente e profissional</Text>

      {/* Aviso de aprovação pendente */}
      {pvStatus === 'pending_review' && (
        <View style={styles.pendingBanner}>
          <Ionicons name="time-outline" size={16} color="#FFA500" />
          <Text style={styles.pendingBannerText}>
            Perfil profissional em análise. Você pode continuar usando o perfil de cliente normalmente.
          </Text>
        </View>
      )}

      <View style={styles.profilesRow}>
        {/* CLIENTE */}
        {hasClient ? (
          <TouchableOpacity
            style={[styles.profileChip, active === 'client' && styles.profileChipActive]}
            onPress={() => switchTo('client')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="home-outline"
              size={18}
              color={active === 'client' ? colors.white : colors.primary}
            />
            <Text style={[styles.profileChipText, active === 'client' && styles.profileChipTextActive]}>
              Cliente
            </Text>
            {active === 'client' && (
              <Ionicons name="checkmark-circle" size={14} color={colors.white} />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.profileChipAdd}
            onPress={enableClientProfile}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.profileChipAddText}>Ser cliente</Text>
          </TouchableOpacity>
        )}

        {/* PROFISSIONAL */}
        {hasProfessional ? (
          <TouchableOpacity
            style={[styles.profileChip, active === 'professional' && styles.profileChipActivePro]}
            onPress={() => switchTo('professional')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="briefcase-outline"
              size={18}
              color={active === 'professional' ? colors.white : colors.secondary}
            />
            <Text style={[styles.profileChipText, active === 'professional' && { color: colors.white }]}>
              Profissional
            </Text>
            {active === 'professional' && (
              <Ionicons name="checkmark-circle" size={14} color={colors.white} />
            )}
          </TouchableOpacity>
        ) : (
          renderProfessionalUpgradeButton()
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(255,165,0,0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,165,0,0.2)',
  },
  pendingBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#FFA500',
    lineHeight: 16,
  },
  profilesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  profileChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  profileChipActivePro: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  profileChipText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  profileChipTextActive: {
    color: colors.white,
  },
  profileChipAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  profileChipDisabled: {
    opacity: 0.6,
    borderColor: '#555',
  },
  profileChipPending: {
    borderColor: 'rgba(255,165,0,0.4)',
    backgroundColor: 'rgba(255,165,0,0.05)',
    paddingVertical: 6,
  },
  profileChipAddText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary,
  },
});


/**
 * ProfileSwitcher
 * Exibe badges dos perfis disponíveis e permite ativar outro perfil ou criar um novo.
 * Ao trocar de perfil, atualiza o contexto e recarrega a navegação via updateUser.
 */
export default function ProfileSwitcher({ onSwitch, navigation }) {
  const { user, setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const hasClient = Boolean(user?.profileModes?.client || user?.userType === 'client');
  const hasProfessional = Boolean(user?.profileModes?.professional || user?.userType === 'professional');
  const active = user?.activeProfile || user?.userType;

  const switchTo = async (profile) => {
    if (profile === active) return;
    setLoading(true);
    try {
      const { data } = await userAPI.switchProfile(profile);
      setUser(data.user);
      if (onSwitch) onSwitch(data.user);
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível alternar perfil.');
    } finally {
      setLoading(false);
    }
  };

  const enableProfile = async (profile) => {
    if (profile === 'professional') {
      const status = user?.verificationStatus;
      const hasResidence = Boolean(user?.residenceProofUrl);

      if (status === 'approved' && hasResidence) {
        // Já aprovado e tem comprovante — apenas habilitar
        setLoading(true);
        try {
          await userAPI.enableProfile(profile);
          const { data } = await userAPI.getMe();
          setUser(data.user);
          Alert.alert('Perfil ativado', 'Seu perfil profissional foi ativado!');
        } catch (err) {
          Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível ativar o perfil.');
        } finally {
          setLoading(false);
        }
        return;
      }

      if (status === 'approved' && !hasResidence) {
        // Aprovado mas sem comprovante de residência
        Alert.alert(
          'Comprovante necessário',
          'Para usar o perfil profissional, precisamos do seu comprovante de residência.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Enviar agora',
              onPress: () => navigation?.navigate('ResidenceProofUpload'),
            },
          ]
        );
        return;
      }

      // Não aprovado — fluxo completo de documentos
      Alert.alert(
        'Verificação necessária',
        'Para usar o perfil profissional é necessário enviar documentos de verificação.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Enviar documentos',
            onPress: () => navigation?.navigate('DocumentUpload'),
          },
        ]
      );
      return;
    }

    // Perfil de cliente
    const label = 'cliente';
    Alert.alert(
      `Criar perfil ${label}`,
      `Isso criará um perfil de ${label} nesta conta. Deseja continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Criar',
          onPress: async () => {
            setLoading(true);
            try {
              await userAPI.enableProfile(profile);
              const { data } = await userAPI.getMe();
              setUser(data.user);
              Alert.alert('Perfil criado', 'Seu perfil de cliente foi ativado!');
            } catch (err) {
              Alert.alert('Erro', err?.response?.data?.message || 'Não foi possível criar o perfil.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Perfis</Text>
      <Text style={styles.subtitle}>Alternar entre perfil de cliente e profissional</Text>

      <View style={styles.profilesRow}>
        {/* Cliente */}
        {hasClient ? (
          <TouchableOpacity
            style={[styles.profileChip, active === 'client' && styles.profileChipActive]}
            onPress={() => switchTo('client')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="home-outline"
              size={18}
              color={active === 'client' ? colors.white : colors.primary}
            />
            <Text style={[styles.profileChipText, active === 'client' && styles.profileChipTextActive]}>
              Cliente
            </Text>
            {active === 'client' && (
              <Ionicons name="checkmark-circle" size={14} color={colors.white} />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.profileChipAdd}
            onPress={() => enableProfile('client')}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.profileChipAddText}>Ser cliente</Text>
          </TouchableOpacity>
        )}

        {/* Profissional */}
        {hasProfessional ? (
          <TouchableOpacity
            style={[styles.profileChip, active === 'professional' && styles.profileChipActivePro]}
            onPress={() => switchTo('professional')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="briefcase-outline"
              size={18}
              color={active === 'professional' ? colors.white : colors.secondary}
            />
            <Text style={[styles.profileChipText, active === 'professional' && styles.profileChipTextActive]}>
              Profissional
            </Text>
            {active === 'professional' && (
              <Ionicons name="checkmark-circle" size={14} color={colors.white} />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.profileChipAdd}
            onPress={() => enableProfile('professional')}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.secondary} />
            <Text style={[styles.profileChipAddText, { color: colors.secondary }]}>Ser profissional</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  profilesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  profileChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  profileChipActivePro: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  profileChipText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  profileChipTextActive: {
    color: colors.white,
  },
  profileChipAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  profileChipAddText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary,
  },
});
