import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ActivityIndicator, Alert, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

const LABELS = ['', 'Difícil 😕', 'Regular 😐', 'Boa 😊', 'Ótima 😁', 'Incrível! 🤩'];

export default function ProfessionalReviewScreen({ navigation, route }) {
  const { requestId, clientName } = route.params;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [npsScore, setNpsScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState(null);

  useEffect(() => {
    requestAPI.getById(requestId)
      .then(({ data }) => setRequest(data.request))
      .catch(() => {});
  }, [requestId]);

  const displayName = clientName || request?.client?.name || 'o cliente';

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert('Atenção', 'Por favor, selecione uma avaliação.');
      return;
    }
    setLoading(true);
    try {
      await requestAPI.review(requestId, rating, comment, npsScore);
      navigation.replace('Dashboard');
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a avaliação.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => navigation.replace('Dashboard');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        <LinearGradient
          colors={rating >= 4 ? colors.gradientSuccess : colors.gradientSecondary}
          style={styles.topSection}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.successCircle}>
            <LinearGradient colors={colors.gradientSuccess} style={styles.successGradient}>
              <Ionicons name="checkmark" size={40} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.completedText}>Serviço concluído!</Text>
          <Text style={styles.completedSub}>Como foi trabalhar com {displayName}?</Text>
        </LinearGradient>

        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)} activeOpacity={0.7}>
                  <Ionicons
                    name={star <= rating ? 'star' : 'star-outline'}
                    size={44}
                    color={star <= rating ? '#FFB300' : colors.border}
                    style={styles.star}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {rating > 0 && (
              <Text style={styles.ratingLabel}>{LABELS[rating]}</Text>
            )}

            <TextInput
              style={styles.commentInput}
              placeholder="Comentário opcional..."
              placeholderTextColor={colors.textLight}
              multiline
              numberOfLines={3}
              value={comment}
              onChangeText={setComment}
              maxLength={500}
            />

            {/* Pergunta NPS */}
            <View style={styles.npsSection}>
              <Text style={styles.npsTitle}>📱 Avalie o app</Text>
              <Text style={styles.npsQuestion}>
                Em uma escala de 0 a 10, o quanto você recomendaria o Já! para um amigo?
              </Text>
              <View style={styles.npsRow}>
                {Array.from({ length: 11 }, (_, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.npsBtn,
                      i <= 6 ? styles.npsBtnDetractor : i <= 8 ? styles.npsBtnPassive : styles.npsBtnPromotor,
                      npsScore === i && styles.npsBtnActive,
                      npsScore === i && { backgroundColor: i <= 6 ? '#e53935' : i <= 8 ? '#f9a825' : '#43a047' }]}
                    onPress={() => setNpsScore(npsScore === i ? null : i)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.npsBtnText, npsScore === i && styles.npsBtnTextSelected]}>{i}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.npsLabels}>
                <Text style={styles.npsLabelLeft}>Nada provável</Text>
                <Text style={styles.npsLabelRight}>Muito provável</Text>
              </View>
              {npsScore !== null && (
                <Text style={styles.npsHint}>
                  {npsScore <= 6 ? '😕 Que pena! Vamos melhorar.' : npsScore <= 8 ? '🙂 Obrigado pelo feedback!' : '🤩 Incrível! Fico feliz em ouvir!'}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.btn, (loading || rating === 0) && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading || rating === 0}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={(loading || rating === 0) ? ['#ccc', '#bbb'] : colors.gradientSecondary}
                style={styles.btnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>Enviar avaliação</Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
              <Text style={styles.skipText}>Pular avaliação</Text>
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
    paddingTop: 48,
    paddingBottom: 32,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: 8,
  },
  successCircle: { marginBottom: 12 },
  successGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedText: { ...typography.h2, color: '#fff' },
  completedSub: { ...typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xl,
    marginTop: -16,
  },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: spacing.lg },
  star: { marginHorizontal: 4 },
  ratingLabel: { ...typography.h3, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  commentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  btn: {},
  btnDisabled: { opacity: 0.6 },
  btnGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
  },
  btnText: { ...typography.button, color: '#fff' },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.md },
  skipText: { ...typography.body, color: colors.textLight },
  npsSection: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: `${colors.primary}08`,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: `${colors.primary}20`,
  },
  npsTitle: { ...typography.h3, color: colors.text, marginBottom: 4 },
  npsQuestion: { ...typography.body, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.md },
  npsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  npsBtn: {
    width: 28, height: 28, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  npsBtnDetractor: { borderColor: '#FFCDD2' },
  npsBtnPassive:   { borderColor: '#FFF9C4' },
  npsBtnPromotor:  { borderColor: '#C8E6C9' },
  npsBtnActive: { borderWidth: 2 },
  npsBtnText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  npsBtnTextSelected: { color: colors.white, fontWeight: '700' },
  npsLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  npsLabelLeft:  { fontSize: 10, color: colors.textLight },
  npsLabelRight: { fontSize: 10, color: colors.textLight },
  npsHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, fontWeight: '500' },
});
