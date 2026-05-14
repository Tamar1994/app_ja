import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { serviceChatAPI } from '../../services/api';
import { colors } from '../../theme';

const POLL_INTERVAL_MS = 5000;

export default function ServiceChatScreen({ navigation, route }) {
  const { requestId, peerName } = route.params;
  const [chat, setChat] = useState(null);
  const [request, setRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef(null);
  const pollingRef = useRef(null);

  const loadChat = useCallback(async () => {
    const res = await serviceChatAPI.getByRequest(requestId);
    setChat(res.data.chat);
    setRequest(res.data.request);
    setMessages(res.data.chat?.messages || []);
  }, [requestId]);

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      try {
        await loadChat();
      } finally {
        if (mounted) setLoading(false);
      }
    };
    start();

    pollingRef.current = setInterval(() => {
      loadChat().catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loadChat]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !chat || chat.status !== 'active') return;
    setSending(true);
    setInputText('');
    try {
      const res = await serviceChatAPI.sendMessage(requestId, text);
      setChat(res.data.chat);
      setMessages(res.data.chat?.messages || []);
    } catch {
      setInputText(text);
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (date) => {
    const d = new Date(date);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{peerName || 'Chat do serviço'}</Text>
          <Text style={styles.headerSub}>
            {chat?.status === 'closed'
              ? 'Chat encerrado'
              : request?.status === 'in_progress'
              ? 'Serviço em andamento'
              : request?.status === 'on_the_way'
              ? 'Profissional a caminho'
              : request?.status === 'preparing'
              ? 'Profissional se preparando'
              : 'Serviço confirmado'}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.msgList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Nenhuma mensagem ainda.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isClientMessage = item.sender === 'client';
            const isMyMessage =
              (route.params.role === 'client' && isClientMessage) ||
              (route.params.role === 'professional' && !isClientMessage);
            return (
              <View style={[styles.msgWrapper, isMyMessage ? styles.msgWrapperMine : styles.msgWrapperOther]}>
                <View style={[styles.msgBubble, isMyMessage ? styles.msgBubbleMine : styles.msgBubbleOther]}>
                  <Text style={[styles.msgText, isMyMessage ? styles.msgTextMine : styles.msgTextOther]}>{item.text}</Text>
                </View>
                <Text style={[styles.msgTime, isMyMessage ? styles.msgTimeMine : styles.msgTimeOther]}>{fmtTime(item.createdAt)}</Text>
              </View>
            );
          }}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.chatInput}
            placeholder={chat?.status === 'closed' ? 'Chat encerrado' : 'Digite sua mensagem...'}
            placeholderTextColor={colors.textLight}
            value={inputText}
            onChangeText={setInputText}
            multiline
            editable={chat?.status === 'active'}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending || chat?.status !== 'active') && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending || chat?.status !== 'active'}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#E8ECF4',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  headerSub: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  msgList: { padding: 16, paddingBottom: 8 },
  emptyState: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.textLight },
  msgWrapper: { marginBottom: 10 },
  msgWrapperMine: { alignItems: 'flex-end' },
  msgWrapperOther: { alignItems: 'flex-start' },
  msgBubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  msgBubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  msgBubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 6 },
  msgText: { fontSize: 15, lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  msgTextOther: { color: colors.textPrimary },
  msgTime: { fontSize: 11, color: colors.textLight, marginTop: 4 },
  msgTimeMine: { textAlign: 'right' },
  msgTimeOther: { textAlign: 'left' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E8ECF4',
  },
  chatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendBtnDisabled: { opacity: 0.5 },
});
