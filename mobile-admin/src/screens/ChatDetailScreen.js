import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { adminSupportAPI } from '../services/api';
import { getAdminSocket } from '../services/socket';
import { colors, spacing, borderRadius, typography } from '../theme';

const POLL_MS = 6000;

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://ja-backend-gpow.onrender.com/api').replace(/\/api\/?$/, '');

function buildImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function Bubble({ msg }) {
  // Mensagens de sistema: pill centralizada
  if (msg.sender === 'system') {
    return (
      <View style={styles.sysMsgRow}>
        <View style={styles.sysMsgPill}>
          <Text style={styles.sysMsgText}>{msg.text}</Text>
        </View>
      </View>
    );
  }
  const isMe = msg.sender === 'support';
  const imgUri = buildImageUrl(msg.imageUrl);
  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowUser]}>
      {!isMe && (
        <View style={styles.bubbleAvatar}>
          <Ionicons name="person" size={14} color={colors.white} />
        </View>
      )}
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleUser]}>
        {msg.text ? (
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.text}</Text>
        ) : null}
        {imgUri ? (
          <Image
            source={{ uri: imgUri }}
            style={styles.bubbleImage}
            resizeMode="cover"
          />
        ) : null}
        <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
          {formatTime(msg.createdAt)}
          {isMe && <Text>  ✓</Text>}
        </Text>
      </View>
    </View>
  );
}

export default function ChatDetailScreen({ route, navigation }) {
  const { chatId } = route.params;
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const flatListRef = useRef(null);
  const pollRef = useRef(null);

  const loadChat = useCallback(async (silent = false) => {
    try {
      const res = await adminSupportAPI.getChat(chatId);
      const c = res.data.chat;
      setChat(c);
      setMessages(c.messages || []);
      if (!silent) setLoading(false);
    } catch {
      if (!silent) {
        setLoading(false);
        Alert.alert('Erro', 'Não foi possível carregar o chat.');
      }
    }
  }, [chatId]);

  // Scroll para o final ao receber novas mensagens
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Socket — ouve mensagens em tempo real
  useEffect(() => {
    loadChat();
    const socket = getAdminSocket();
    if (socket) {
      const handler = (data) => {
        if (String(data.chatId) === String(chatId)) {
          loadChat(true);
        }
      };
      socket.on('support_message', handler);
      return () => socket.off('support_message', handler);
    }
  }, [chatId, loadChat]);

  // Polling de fallback
  useEffect(() => {
    pollRef.current = setInterval(() => loadChat(true), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [loadChat]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    // Otimista: adiciona mensagem localmente antes do response
    const optimistic = {
      _id: `opt_${Date.now()}`,
      sender: 'support',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInputText('');
    setSending(true);

    try {
      await adminSupportAPI.sendMessage(chatId, text);
      // Recarrega para sincronizar _id real e data do servidor
      await loadChat(true);
    } catch (err) {
      // Remove a mensagem otimista se falhou
      setMessages(prev => prev.filter(m => m._id !== optimistic._id));
      setInputText(text);
      Alert.alert('Erro', err?.response?.data?.message || 'Falha ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    Alert.alert(
      'Encerrar atendimento',
      `Deseja encerrar o chat com ${chat?.userId?.name || 'o usuário'}? Ele será notificado.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Encerrar',
          style: 'destructive',
          onPress: async () => {
            setClosing(true);
            try {
              await adminSupportAPI.closeChat(chatId);
              navigation.goBack();
            } catch {
              Alert.alert('Erro', 'Não foi possível encerrar o chat.');
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isClosed = chat?.status === 'closed';
  const isP1 = chat?.priority === 'p1';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={isP1 ? colors.p1 : colors.primaryDark} translucent={false} />

      {/* Header */}
      <LinearGradient
        colors={isP1 ? [colors.p1, '#B71C1C'] : colors.gradientPrimary}
        style={styles.header}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {chat?.userId?.name || 'Usuário'}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {isP1 ? '⚠️ P1 — ' : ''}{chat?.subject || 'Sem assunto'}
          </Text>
        </View>

        {!isClosed && (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={handleClose}
            disabled={closing}
          >
            {closing
              ? <ActivityIndicator size="small" color={colors.white} />
              : <Ionicons name="close-circle-outline" size={24} color={colors.white} />
            }
          </TouchableOpacity>
        )}
      </LinearGradient>

      {/* Info do usuário */}
      <View style={styles.userInfoBar}>
        <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.userInfoText}>{chat?.userId?.email || ''}</Text>
        {isClosed && (
          <View style={styles.closedBadge}>
            <Text style={styles.closedBadgeText}>Encerrado</Text>
          </View>
        )}
      </View>

      {/* Contexto P1 */}
      {isP1 && !!chat?.emergencyContext && (
        <View style={styles.emergencyBanner}>
          <Ionicons name="warning" size={14} color={colors.p1} />
          <Text style={styles.emergencyText}>{chat.emergencyContext}</Text>
        </View>
      )}

      {/* Mensagens */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item, i) => String(item._id || i)}
          renderItem={({ item }) => <Bubble msg={item} />}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.border} />
              <Text style={styles.emptyMessagesText}>Nenhuma mensagem ainda</Text>
            </View>
          }
        />

        {/* Input */}
        {!isClosed ? (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Responder ao usuário..."
              placeholderTextColor={colors.textLight}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
              activeOpacity={0.8}
            >
              {sending
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="send" size={20} color={colors.white} />
              }
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.closedBar}>
            <Ionicons name="lock-closed" size={14} color={colors.textLight} />
            <Text style={styles.closedBarText}>Este atendimento foi encerrado</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerName: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.white,
  },
  headerSub: {
    fontSize: typography.fontSizes.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  userInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userInfoText: {
    flex: 1,
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
  },
  closedBadge: {
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  closedBadgeText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },

  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.p1bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#FFCDD2',
  },
  emergencyText: {
    flex: 1,
    fontSize: typography.fontSizes.xs,
    color: colors.p1,
    fontWeight: '600',
    lineHeight: 18,
  },

  messageList: {
    padding: spacing.md,
    gap: spacing.xs,
    flexGrow: 1,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: spacing.sm,
  },
  emptyMessagesText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
  },

  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: 3,
  },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubbleRowUser: { justifyContent: 'flex-start' },
  bubbleAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  bubbleTextMe: { color: colors.white },
  bubbleTime: {
    fontSize: 10,
    color: colors.textLight,
    marginTop: 4,
    textAlign: 'right',
  },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.65)' },
  bubbleImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
    marginTop: 6,
    backgroundColor: colors.border,
  },
  // Mensagens de sistema
  sysMsgRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 12 },
  sysMsgPill: {
    backgroundColor: '#EEEEF4',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    maxWidth: '85%',
  },
  sysMsgText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 17,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: typography.fontSizes.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  closedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.md,
    backgroundColor: colors.divider,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  closedBarText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
    fontWeight: '500',
  },
});
