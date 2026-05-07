import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { helpAPI } from '../../services/api';
import { colors } from '../../theme';

export default function HelpCenterScreen({ navigation }) {
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTopics, setExpandedTopics] = useState({});
  const [expandedItems, setExpandedItems] = useState({});
  const [ratingLoading, setRatingLoading] = useState({});

  const loadTopics = useCallback(async () => {
    try {
      const res = await helpAPI.getTopics();
      setTopics(res.data.topics || []);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar a central de ajuda.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const toggleTopic = (id) => {
    setExpandedTopics(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleItem = (id) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const rateItem = async (itemId, helpful) => {
    setRatingLoading(prev => ({ ...prev, [itemId]: true }));
    try {
      await helpAPI.rateItem(itemId, helpful);
      Alert.alert('Obrigado!', helpful ? 'Fico feliz que ajudou! 😊' : 'Vamos melhorar essa resposta. 📝');
      loadTopics();
    } catch {
      Alert.alert('Erro', 'Não foi possível registrar sua avaliação.');
    } finally {
      setRatingLoading(prev => ({ ...prev, [itemId]: false }));
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Central de Ajuda</Text>
        <Text style={styles.headerSubtitle}>Como podemos te ajudar?</Text>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {topics.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyText}>Nenhum tópico disponível ainda.</Text>
          </View>
        ) : (
          topics.map((topic) => (
            <View key={topic._id} style={styles.topicCard}>
              {/* Topic Header */}
              <TouchableOpacity
                style={styles.topicHeader}
                onPress={() => toggleTopic(topic._id)}
                activeOpacity={0.7}
              >
                <View style={styles.topicIconContainer}>
                  <Text style={styles.topicIcon}>{topic.icon || '❓'}</Text>
                </View>
                <View style={styles.topicInfo}>
                  <Text style={styles.topicTitle}>{topic.title || topic.name}</Text>
                  {topic.description ? (
                    <Text style={styles.topicDescription}>{topic.description}</Text>
                  ) : null}
                </View>
                <Ionicons
                  name={expandedTopics[topic._id] ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textLight}
                />
              </TouchableOpacity>

              {/* Items */}
              {expandedTopics[topic._id] && (
                <View style={styles.itemsList}>
                  {(topic.items || []).length === 0 ? (
                    <Text style={styles.noItemsText}>Nenhuma pergunta neste tópico.</Text>
                  ) : (
                    topic.items.map((item) => (
                      <View key={item._id} style={styles.itemContainer}>
                        <TouchableOpacity
                          style={styles.itemQuestion}
                          onPress={() => toggleItem(item._id)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.itemQuestionText}>❓ {item.question}</Text>
                          <Ionicons
                            name={expandedItems[item._id] ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={colors.textLight}
                          />
                        </TouchableOpacity>
                        {expandedItems[item._id] && (
                          <View style={styles.itemAnswer}>
                            <Text style={styles.itemAnswerText}>{item.answer}</Text>
                            <Text style={styles.helpfulLabel}>Isso te ajudou?</Text>
                            <View style={styles.ratingRow}>
                              <TouchableOpacity
                                style={[styles.ratingBtn, styles.ratingYes]}
                                onPress={() => rateItem(item._id, true)}
                                disabled={!!ratingLoading[item._id]}
                              >
                                {ratingLoading[item._id] ? (
                                  <ActivityIndicator size="small" color="#00C853" />
                                ) : (
                                  <Text style={styles.ratingYesText}>👍 Sim ({item.ratings?.helpful || 0})</Text>
                                )}
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.ratingBtn, styles.ratingNo]}
                                onPress={() => rateItem(item._id, false)}
                                disabled={!!ratingLoading[item._id]}
                              >
                                {ratingLoading[item._id] ? (
                                  <ActivityIndicator size="small" color="#FF453A" />
                                ) : (
                                  <Text style={styles.ratingNoText}>👎 Não ({item.ratings?.notHelpful || 0})</Text>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </View>
              )}
            </View>
          ))
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.ctaContainer}>
        <Text style={styles.ctaText}>Não encontrou o que precisava?</Text>
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('SupportChat')}
          activeOpacity={0.85}
        >
          <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
          <Text style={styles.ctaButtonText}>💬 Falar com Suporte</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: colors.primary,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: colors.textLight, textAlign: 'center' },
  topicCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  topicHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  topicIconContainer: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(255,107,0,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  topicIcon: { fontSize: 22 },
  topicInfo: { flex: 1 },
  topicTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  topicDescription: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  itemsList: { borderTopWidth: 1, borderTopColor: '#F0F2F8' },
  noItemsText: { padding: 16, fontSize: 13, color: colors.textLight, fontStyle: 'italic' },
  itemContainer: { borderBottomWidth: 1, borderBottomColor: '#F0F2F8' },
  itemQuestion: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 14, paddingLeft: 20,
  },
  itemQuestionText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, lineHeight: 20 },
  itemAnswer: { backgroundColor: '#F8F9FD', paddingHorizontal: 20, paddingBottom: 16, paddingTop: 4 },
  itemAnswerText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  helpfulLabel: { marginTop: 12, fontSize: 12, fontWeight: '600', color: colors.textLight },
  ratingRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  ratingBtn: { flex: 1, paddingVertical: 8, borderRadius: 20, alignItems: 'center' },
  ratingYes: { backgroundColor: 'rgba(0,200,83,0.1)', borderWidth: 1, borderColor: 'rgba(0,200,83,0.3)' },
  ratingNo: { backgroundColor: 'rgba(255,59,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)' },
  ratingYesText: { fontSize: 13, fontWeight: '600', color: '#00A844' },
  ratingNoText: { fontSize: 13, fontWeight: '600', color: '#D9392C' },
  ctaContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#E8ECF4',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 10,
  },
  ctaText: { fontSize: 12, color: colors.textLight, marginBottom: 10 },
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 28, width: '100%', justifyContent: 'center',
  },
  ctaButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
