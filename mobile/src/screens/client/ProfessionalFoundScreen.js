import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, borderRadius } from '../../theme';
import { requestAPI } from '../../services/api';

export default function ProfessionalFoundScreen({ route, navigation }) {
  const { requestId, professional } = route.params;
  const [loading, setLoading] = useState(false);

  const handleAccept = () => {
    navigation.replace('Tracking', { requestId });
  };

  const handleFindAnother = async () => {
    Alert.alert(
      'Buscar outro profissional?',
      `${professional?.name} será substituído e continuaremos buscando outro profissional perto de você.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Buscar outro',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await requestAPI.clientReject(requestId, professional?._id);
              navigation.replace('Searching', { requestId });
            } catch {
              Alert.alert('Erro', 'Não foi possível buscar outro profissional. Tente novamente.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const rating = professional?.rating || 0;
  const totalReviews = professional?.totalReviews || 0;

  const initials = (professional?.name || 'P')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <LinearGradient colors={['#F5F6FA', '#E8F0FE']} style={styles.gradient}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={36} color="#43A047" />
          <Text style={styles.headerTitle}>Profissional encontrado!</Text>
          <Text style={styles.headerSub}>
            Revise as informações e confirme para iniciar o serviço
          </Text>
        </View>

        {/* Card do profissional */}
        <View style={styles.card}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <LinearGradient
              colors={[colors.primary, '#FF8C38']}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitials}>{initials}</Text>
            </LinearGradient>
            {/* Selo de verificado */}
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={16} color="#fff" />
            </View>
          </View>

          <Text style={styles.name}>{professional?.name || 'Profissional'}</Text>

          {/* Rating */}
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map(star => (
              <Ionicons
                key={star}
                name={star <= Math.round(rating) ? 'star' : 'star-outline'}
                size={20}
                color="#FFD700"
              />
            ))}
            <Text style={styles.ratingText}>
              {rating > 0 ? rating.toFixed(1) : 'Novo'}
              {totalReviews > 0 ? ` (${totalReviews} avaliações)` : ''}
            </Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Info extra */}
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.secondary} />
            <Text style={styles.infoText}>Profissional verificado e aprovado</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={18} color={colors.secondary} />
            <Text style={styles.infoText}>A caminho da sua residência</Text>
          </View>
        </View>

        {/* Aviso */}
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.noticeText}>
            Ao confirmar, o profissional receberá seus dados e iniciará o deslocamento.
          </Text>
        </View>

        {/* Botões */}
        <TouchableOpacity
          style={styles.acceptBtn}
          onPress={handleAccept}
          activeOpacity={0.85}
          disabled={loading}
        >
          <LinearGradient colors={[colors.primary, '#FF8C38']} style={styles.acceptGradient}>
            <Ionicons name="checkmark-circle" size={22} color="#fff" />
            <Text style={styles.acceptText}>Confirmar profissional</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rejectBtn}
          onPress={handleFindAnother}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <>
              <Ionicons name="refresh" size={18} color={colors.textSecondary} />
              <Text style={styles.rejectText}>Procurar outro profissional</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    gap: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headerSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
    marginBottom: 16,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatarGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#43A047',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 20,
  },
  ratingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#F0F0F0',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(255,107,0,0.08)',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 28,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  acceptBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  acceptGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  acceptText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  rejectBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  rejectText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
});
