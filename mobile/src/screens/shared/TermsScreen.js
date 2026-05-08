import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { termsAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export default function TermsScreen({ navigation }) {
  const [content, setContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await termsAPI.get();
        setContent(data.content || '');
        setUpdatedAt(data.updatedAt || null);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <LinearGradient
        colors={['#FF8C38', '#FF6B00', '#E55A00']}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Termos de Uso</Text>
        <View style={{ width: 38 }} />
      </LinearGradient>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.errorWrap}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textLight} />
          <Text style={styles.errorText}>Não foi possível carregar os termos de uso.</Text>
          <Text style={styles.errorSub}>Verifique sua conexão e tente novamente.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {updatedAt && (
            <Text style={styles.updatedAt}>
              Última atualização: {new Date(updatedAt).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}
            </Text>
          )}

          <View style={styles.card}>
            {content.trim() ? (
              content.split('\n').map((line, i) => {
                if (!line.trim()) return <View key={i} style={{ height: 10 }} />;
                const isTitle = line.startsWith('#');
                return (
                  <Text
                    key={i}
                    style={isTitle ? styles.sectionTitle : styles.bodyText}
                  >
                    {isTitle ? line.replace(/^#+\s*/, '') : line}
                  </Text>
                );
              })
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="document-text-outline" size={48} color={colors.textLight} />
                <Text style={styles.emptyText}>Os termos de uso ainda não foram publicados.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 55,
    paddingBottom: 20,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.white,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 40 },
  updatedAt: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
    marginTop: 16,
  },
  bodyText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 4,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: typography.fontSizes.md,
    color: colors.textLight,
    textAlign: 'center',
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: spacing.xl,
  },
  errorText: {
    fontSize: typography.fontSizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  errorSub: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
    textAlign: 'center',
  },
});
