import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { termsAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function AcceptTermsScreen() {
  const { setUser, logout } = useAuth();
  const [content, setContent] = useState('');
  const [loadingTerms, setLoadingTerms] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await termsAPI.get();
        setContent(data.content || 'Termos de uso não disponíveis no momento.');
      } catch {
        setContent('Não foi possível carregar os termos. Verifique sua conexão.');
      } finally {
        setLoadingTerms(false);
      }
    })();
  }, []);

  const handleScroll = ({ nativeEvent }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < 40 && !scrolledToBottom) {
      setScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    if (!accepted) {
      Alert.alert('Atenção', 'Você precisa marcar que leu e aceita os Termos de Uso para continuar.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await termsAPI.accept();
      if (setUser) setUser(data.user);
      // RootNavigator re-renderiza automaticamente ao detectar termsAcceptedAt preenchido
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível registrar o aceite. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <LinearGradient
        colors={['#FF8C38', '#FF6B00', '#E55A00']}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headerContent}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="document-text" size={32} color={colors.white} />
            </View>
            <Text style={styles.headerTitle}>Termos de Uso</Text>
            <Text style={styles.headerSub}>
              Leia atentamente antes de continuar
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Conteúdo dos termos */}
      {loadingTerms ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator
        >
          <View style={styles.termsBubble}>
            <Text style={styles.termsText}>{content}</Text>
          </View>

          {!scrolledToBottom && (
            <TouchableOpacity
              style={styles.scrollHint}
              onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-down-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.scrollHintText}>Role até o final para aceitar</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Footer fixo */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {/* Checkbox */}
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setAccepted((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
            {accepted && <Ionicons name="checkmark" size={14} color={colors.white} />}
          </View>
          <Text style={styles.checkLabel}>
            Li e concordo com os{' '}
            <Text style={styles.checkLabelBold}>Termos de Uso</Text>
          </Text>
        </TouchableOpacity>

        {/* Botão continuar */}
        <TouchableOpacity
          style={[styles.btn, (!accepted || submitting) && styles.btnDisabled]}
          onPress={handleAccept}
          disabled={!accepted || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Text style={styles.btnText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.white} />
            </>
          )}
        </TouchableOpacity>

        {/* Sair */}
        <TouchableOpacity onPress={logout} style={styles.logoutBtn} activeOpacity={0.7}>
          <Text style={styles.logoutText}>Sair da conta</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingBottom: spacing.xl,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSizes['2xl'] || 24,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: typography.fontSizes.sm || 14,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  termsBubble: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl || 16,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  termsText: {
    fontSize: typography.fontSizes.sm || 14,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  scrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  scrollHintText: {
    fontSize: typography.fontSizes.sm || 14,
    color: colors.primary,
    fontWeight: '600',
  },
  footer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border || '#EEF0F4',
    gap: spacing.sm,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs || 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkLabel: {
    flex: 1,
    fontSize: typography.fontSizes.sm || 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  checkLabelBold: {
    color: colors.primary,
    fontWeight: '700',
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg || 12,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnDisabled: {
    backgroundColor: colors.textLight || '#BABDC8',
  },
  btnText: {
    color: colors.white,
    fontSize: typography.fontSizes.md || 16,
    fontWeight: '700',
  },
  logoutBtn: {
    alignItems: 'center',
    paddingVertical: spacing.xs || 4,
  },
  logoutText: {
    fontSize: typography.fontSizes.sm || 14,
    color: colors.textSecondary,
  },
});
