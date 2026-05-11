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
      await requestAPI.review(requestId, rating, comment);
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
});
