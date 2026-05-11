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
