import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ActivityIndicator, Alert, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { requestAPI, supportChatAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const LABELS = ['', 'Ruim 😕', 'Regular 😐', 'Bom 😊', 'Ótimo 😁', 'Incrível! 🤩'];

export default function ReviewScreen({ navigation, route }) {
  const { requestId, professionalName } = route.params;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [reporting, setReporting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert('Atenção', 'Por favor, selecione uma avaliação.');
      return;
    }
    setLoading(true);
    try {
      await requestAPI.review(requestId, rating, comment);
      navigation.replace('Home');
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a avaliação.');
    } finally {
      setLoading(false);
    }
  };

  const handleReport = async () => {
    setReporting(true);
    try {
      const { data } = await supportChatAPI.create(`Problema no serviço - Pedido #${requestId?.slice(-6)}`);
      navigation.replace('Home');
      // Navegar para suporte após voltar ao Home seria via tab, simplificando:
      Alert.alert('Suporte aberto', 'Vá até a aba Suporte para continuar o atendimento.');
    } catch {
      Alert.alert('Erro', 'Não foi possível abrir o suporte. Tente pela aba Suporte.');
    } finally {
      setReporting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={rating >= 4 ? colors.gradientSuccess : rating >= 2 ? colors.gradientPrimary : ['#F5F6FA', '#F5F6FA']}
        style={styles.topSection}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.successCircle}>
          <LinearGradient colors={colors.gradientSuccess} style={styles.successGradient}>
            <Ionicons name="checkmark" size={40} color={colors.white} />
          </LinearGradient>
        </View>
        <Text style={[styles.completedText, rating >= 2 && { color: colors.white }]}>
          Serviço concluído!
        </Text>
        <Text style={[styles.completedSub, rating >= 2 && { color: 'rgba(255,255,255,0.8)' }]}>
          Esperamos que tenha sido ótimo!
        </Text>
      </LinearGradient>

      <View style={styles.card}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.askText}>
          Como foi o serviço de{'\n'}
          <Text style={styles.proName}>{professionalName || 'seu profissional'}?</Text>
        </Text>

        {/* Estrelas */}
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <TouchableOpacity
              key={i}
              onPress={() => setRating(i)}
              activeOpacity={0.7}
              style={styles.starBtn}
            >
              <Ionicons
                name={i <= rating ? 'star' : 'star-outline'}
                size={44}
                color={i <= rating ? colors.warning : colors.border}
              />
            </TouchableOpacity>
          ))}
        </View>

        {rating > 0 && (
          <View style={styles.ratingLabelWrap}>
            <Text style={styles.ratingLabel}>{LABELS[rating]}</Text>
          </View>
        )}

        {/* Campo de comentário */}
        <TextInput
          style={styles.commentInput}
          placeholder="Deixe um comentário (opcional)..."
          placeholderTextColor={colors.textLight}
          multiline
          numberOfLines={3}
          maxLength={300}
          value={comment}
          onChangeText={setComment}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={styles.btnSubmit}
          onPress={handleSubmit}
          disabled={loading || rating === 0}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={rating === 0 ? ['#E0E0E0', '#D0D0D0'] : colors.gradientPrimary}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {loading
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.btnText}>Enviar avaliação</Text>}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.replace('Home')} style={styles.skipBtn}>
          <Text style={styles.skipText}>Pular por agora</Text>
        </TouchableOpacity>

        {/* Reportar problema */}
        <TouchableOpacity
          style={styles.reportBtn}
          onPress={handleReport}
          disabled={reporting}
          activeOpacity={0.8}
        >
          {reporting
            ? <ActivityIndicator color={colors.error || '#e53935'} size="small" />
            : (
              <>
                <Ionicons name="flag-outline" size={16} color={colors.error || '#e53935'} />
                <Text style={styles.reportText}>Reportar um problema</Text>
              </>
            )}
        </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topSection: {
    paddingTop: 60,
    paddingBottom: 50,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  successCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    ...shadows.lg,
  },
  successGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedText: {
    fontSize: typography.fontSizes.xxxl,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  completedSub: {
    fontSize: typography.fontSizes.md,
    color: colors.textSecondary,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: -24,
    ...shadows.lg,
  },
  askText: {
    fontSize: typography.fontSizes.xl,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: spacing.xl,
  },
  proName: {
    fontWeight: '800',
    color: colors.textPrimary,
    fontSize: typography.fontSizes.xl,
  },
  starsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  starBtn: { padding: 4 },
  ratingLabelWrap: {
    backgroundColor: `${colors.warning}15`,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.lg,
  },
  ratingLabel: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.warning,
  },
  btnSubmit: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    width: '100%',
    marginTop: spacing.md,
    ...shadows.primary,
  },
  btnGradient: {
    paddingVertical: 17,
    alignItems: 'center',
  },
  btnText: {
    color: colors.white,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
  },
  skipBtn: { marginTop: spacing.lg },
  skipText: {
    color: colors.textLight,
    fontSize: typography.fontSizes.md,
  },
  commentInput: {
    width: '100%',
    minHeight: 80,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    paddingVertical: spacing.sm,
  },
  reportText: {
    color: '#e53935',
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
  },
});

