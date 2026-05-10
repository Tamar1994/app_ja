import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supportChatAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme';

const POLL_INTERVAL_MS = 8000;
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.15.17:3000/api').replace(/\/api\/?$/, '');

function buildImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

export default function SupportChatScreen({ navigation }) {
  const { user } = useAuth();
  const isProfessional = user?.userType === 'professional';
  const [phase, setPhase] = useState('form'); // 'form' | 'waiting' | 'chat' | 'closed'
  const [subject, setSubject] = useState('');
  const [emergencyContext, setEmergencyContext] = useState('');
  const [relatedServiceRequestId, setRelatedServiceRequestId] = useState('');
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [chatPriority, setChatPriority] = useState('normal');
  const [pendingImage, setPendingImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const pollingTimer = useRef(null);
  const flatListRef = useRef(null);

  // Poll for chat status updates
  const pollChatStatus = useCallback(async (id) => {
    try {
      const res = await supportChatAPI.getById(id);
      const chat = res.data.chat;
      if (chat.status === 'assigned') {
        setMessages(chat.messages || []);
        setPhase('chat');
      } else if (chat.status === 'closed') {
        setMessages(chat.messages || []);
        setPhase('closed');
        clearInterval(pollingTimer.current);
      } else {
        // still waiting — refresh messages anyway
        setMessages(chat.messages || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    return () => { if (pollingTimer.current) clearInterval(pollingTimer.current); };
  }, []);

  // Start polling when chatId changes
  useEffect(() => {
    if (!chatId) return;
    pollChatStatus(chatId);
    pollingTimer.current = setInterval(() => pollChatStatus(chatId), POLL_INTERVAL_MS);
    return () => clearInterval(pollingTimer.current);
  }, [chatId, pollChatStatus]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  // Check for existing active chat on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await supportChatAPI.getMy();
        const chat = res.data.chat;
        if (chat) {
          setChatId(chat._id);
          setSubject(chat.subject || '');
          setChatPriority(chat.priority || 'normal');
          setMessages(chat.messages || []);
          if (chat.status === 'assigned') setPhase('chat');
          else if (chat.status === 'closed') setPhase('closed');
          else setPhase('waiting');
        }
      } catch {
        // no active chat — stay on form
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async (priority = 'normal') => {
    if (!subject.trim()) {
      Alert.alert('Campo obrigatório', 'Descreva brevemente o assunto do atendimento.');
      return;
    }
    setCreating(true);
    try {
      const extra = {};
      if (isProfessional && priority === 'p1') {
        extra.priority = 'p1';
        extra.category = 'emergency';
        extra.isEmergency = true;
        extra.emergencyContext = emergencyContext.trim();
        if (relatedServiceRequestId.trim()) {
          extra.relatedServiceRequestId = relatedServiceRequestId.trim();
        }
      }
      const res = await supportChatAPI.create(subject.trim(), extra);
      const { chatId: id, status, priority: createdPriority } = res.data;
      setChatId(id);
      setChatPriority(createdPriority || priority);
      if (status === 'assigned') setPhase('chat');
      else setPhase('waiting');
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Não foi possível iniciar o atendimento.');
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async () => {
    if ((!inputText.trim() && !pendingImage) || !chatId) return;
    const text = inputText.trim();
    const imageAsset = pendingImage;
    setInputText('');
    setPendingImage(null);
    setSendingMsg(true);
    try {
      if (imageAsset) {
        const ext = imageAsset.uri.split('.').pop()?.toLowerCase();
        const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
        const formData = new FormData();
        if (text) formData.append('text', text);
        formData.append('image', {
          uri: imageAsset.uri,
          name: `support.${safeExt}`,
          type: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
        });
        await supportChatAPI.sendImage(chatId, formData);
      } else {
        await supportChatAPI.sendMessage(chatId, text);
      }
      const updated = await supportChatAPI.getById(chatId);
      setMessages(updated.data.chat?.messages || []);
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
      setInputText(text);
      setPendingImage(imageAsset || null);
    } finally {
      setSendingMsg(false);
    }
  };

  const handlePickImage = async () => {
    Alert.alert('Enviar imagem', 'Como deseja selecionar a imagem?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sem recorte', onPress: () => pickImage(false) },
      { text: 'Escolher e recortar', onPress: () => pickImage(true) },
    ]);
  };

  const pickImage = async (allowEditing) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à galeria para enviar imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPendingImage(result.assets[0]);
    }
  };

  const handleCropPendingImage = async () => {
    await pickImage(true);
  };

  const fmtTime = (d) => {
    const date = new Date(d);
    return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── FORM PHASE ────────────────────────────────────────────────────
  if (phase === 'form') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Falar com Suporte</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.formContainer}>
          <View style={styles.formHero}>
            <Text style={styles.heroEmoji}>🎧</Text>
            <Text style={styles.heroTitle}>Precisamos te ajudar!</Text>
            <Text style={styles.heroSub}>
              Descreva brevemente o assunto e um de nossos atendentes irá responder logo.
            </Text>
          </View>
          <Text style={styles.inputLabel}>Assunto do atendimento</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Problema com pagamento, dúvida sobre cadastro..."
            placeholderTextColor={colors.textLight}
            value={subject}
            onChangeText={setSubject}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={styles.charCount}>{subject.length}/200</Text>
          {isProfessional ? (
            <View style={styles.emergencyCard}>
              <Text style={styles.emergencyTitle}>Prioridade 1 para emergência</Text>
              <Text style={styles.emergencySub}>Use quando houver risco real, por exemplo cliente acidentado durante o serviço.</Text>
              <TextInput
                style={styles.emergencyInput}
                placeholder="ID do serviço contratado (opcional)"
                placeholderTextColor={colors.textLight}
                value={relatedServiceRequestId}
                onChangeText={setRelatedServiceRequestId}
                autoCapitalize="none"
                maxLength={36}
              />
              <TextInput
                style={[styles.input, { minHeight: 70, marginTop: 10 }]}
                placeholder="Contexto rápido da emergência (opcional)"
                placeholderTextColor={colors.textLight}
                value={emergencyContext}
                onChangeText={setEmergencyContext}
                multiline
                numberOfLines={2}
                maxLength={250}
              />
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.startBtn, creating && { opacity: 0.7 }]}
            onPress={() => handleCreate('normal')}
            disabled={creating}
            activeOpacity={0.85}
          >
            {creating
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.startBtnText}>🎧 Iniciar Atendimento</Text>}
          </TouchableOpacity>
          {isProfessional ? (
            <TouchableOpacity
              style={[styles.p1Btn, creating && { opacity: 0.7 }]}
              onPress={() => handleCreate('p1')}
              disabled={creating}
              activeOpacity={0.85}
            >
              <Text style={styles.p1BtnText}>🚨 Abrir Chamado Prioridade 1</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  // ── WAITING PHASE ─────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ width: 24 }} />
          <Text style={styles.headerTitle}>Aguardando</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.waitingContainer}>
          <View style={styles.waitingCard}>
            <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 20 }} />
            <Text style={styles.waitingTitle}>{chatPriority === 'p1' ? '🚨 Chamado P1 em atendimento...' : '🕐 Aguardando atendente...'}</Text>
            <Text style={styles.waitingSubject}>Assunto: {subject || 'Suporte geral'}</Text>
            {chatPriority === 'p1' ? (
              <Text style={styles.waitingPriority}>Prioridade 1 enviada para toda a equipe de suporte.</Text>
            ) : null}
            <Text style={styles.waitingNote}>
              Você será atendido em breve. Por favor, aguarde enquanto conectamos com um de nossos especialistas.
            </Text>
            <View style={styles.waitingDivider} />
            <Text style={styles.waitingPoll}>Verificando a cada {POLL_INTERVAL_MS / 1000} segundos...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── CLOSED PHASE ──────────────────────────────────────────────────
  if (phase === 'closed') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ width: 24 }} />
          <Text style={styles.headerTitle}>Atendimento Encerrado</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.closedContainer}>
          <Text style={styles.closedEmoji}>✅</Text>
          <Text style={styles.closedTitle}>Atendimento encerrado</Text>
          <Text style={styles.closedSub}>
            Esperamos ter ajudado! Se tiver mais dúvidas, acesse a Central de Ajuda ou inicie um novo atendimento.
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.navigate('HelpCenter')}
            activeOpacity={0.85}
          >
            <Text style={styles.backBtnText}>← Voltar para Ajuda</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── CHAT PHASE ────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ width: 24 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Suporte ao Vivo</Text>
          <Text style={styles.headerSubj} numberOfLines={1}>{subject || 'Atendimento ativo'}</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.msgList}
          ListEmptyComponent={
            <View style={styles.emptyMsgContainer}>
              <Text style={styles.emptyMsgText}>Nenhuma mensagem ainda. Diga olá! 👋</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.msgWrapper, item.sender === 'user' ? styles.msgWrapperUser : styles.msgWrapperSupport]}>
              {item.sender !== 'user' && (
                <View style={styles.msgAvatar}><Text style={{ fontSize: 12 }}>🎧</Text></View>
              )}
              <View>
                <View style={[styles.msgBubble, item.sender === 'user' ? styles.msgBubbleUser : styles.msgBubbleSupport]}>
                    {item.text ? (
                      <Text style={[styles.msgText, item.sender === 'user' ? styles.msgTextUser : styles.msgTextSupport]}>
                        {item.text}
                      </Text>
                    ) : null}
                    {item.imageUrl ? (
                      <Image source={{ uri: buildImageUrl(item.imageUrl) }} style={styles.msgImage} resizeMode="cover" />
                    ) : null}
                </View>
                <Text style={[styles.msgTime, item.sender === 'user' ? { textAlign: 'right' } : { textAlign: 'left' }]}>
                  {fmtTime(item.createdAt)}
                </Text>
              </View>
            </View>
          )}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        {pendingImage ? (
          <View style={styles.pendingImageRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.pendingImageThumb} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingImageTitle}>Imagem pronta para envio</Text>
              <Text style={styles.pendingImageSub} numberOfLines={1}>{pendingImage.fileName || 'foto selecionada'}</Text>
              <View style={styles.pendingImageActions}>
                <TouchableOpacity style={styles.pendingActionBtn} onPress={handleCropPendingImage}>
                  <Text style={styles.pendingActionText}>Recortar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pendingActionBtn, styles.pendingActionDanger]} onPress={() => setPendingImage(null)}>
                  <Text style={[styles.pendingActionText, styles.pendingActionDangerText]}>Remover</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.attachBtn, pendingImage && styles.attachBtnActive]}
            onPress={handlePickImage}
            disabled={sendingMsg}
          >
            <Ionicons name={pendingImage ? 'checkmark' : 'image-outline'} size={20} color={pendingImage ? '#fff' : colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={styles.chatInput}
            placeholder="Digite sua mensagem..."
            placeholderTextColor={colors.textLight}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() && !pendingImage || sendingMsg) && { opacity: 0.5 }]}
            onPress={handleSend}
            disabled={(!inputText.trim() && !pendingImage) || sendingMsg}
          >
            {sendingMsg
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={20} color="#fff" />}
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  headerSubj: { fontSize: 11, color: colors.textLight, marginTop: 2, textAlign: 'center' },
  // Form
  formContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 32 },
  formHero: { alignItems: 'center', marginBottom: 32 },
  heroEmoji: { fontSize: 56, marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  heroSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E8ECF4',
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: colors.textPrimary,
    textAlignVertical: 'top', minHeight: 90,
  },
  charCount: { fontSize: 11, color: colors.textLight, textAlign: 'right', marginTop: 4, marginBottom: 20 },
  emergencyCard: {
    backgroundColor: '#FFF6F6',
    borderColor: '#F1B1B1',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  emergencyTitle: { color: '#A22A2A', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  emergencySub: { color: '#8E4A4A', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  emergencyInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F1D1D1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.textPrimary,
  },
  startBtn: {
    backgroundColor: colors.primary, borderRadius: 28,
    paddingVertical: 16, alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  p1Btn: {
    marginTop: 10,
    backgroundColor: '#C62828',
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  p1BtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // Waiting
  waitingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  waitingCard: {
    backgroundColor: '#fff', borderRadius: 20,
    padding: 28, alignItems: 'center', width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 6,
  },
  waitingTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  waitingSubject: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  waitingPriority: { fontSize: 12, color: '#B42318', textAlign: 'center', marginBottom: 10, fontWeight: '600' },
  waitingNote: { fontSize: 13, color: colors.textLight, textAlign: 'center', lineHeight: 20 },
  waitingDivider: { height: 1, backgroundColor: '#E8ECF4', width: '80%', marginVertical: 16 },
  waitingPoll: { fontSize: 11, color: colors.textLight },
  // Closed
  closedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  closedEmoji: { fontSize: 64, marginBottom: 16 },
  closedTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  closedSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  backBtn: {
    backgroundColor: colors.primary, borderRadius: 28,
    paddingVertical: 14, paddingHorizontal: 32,
  },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // Chat
  msgList: { padding: 16, paddingBottom: 8 },
  emptyMsgContainer: { alignItems: 'center', paddingTop: 40 },
  emptyMsgText: { color: colors.textLight, fontSize: 13 },
  msgWrapper: { flexDirection: 'row', marginBottom: 14, maxWidth: '80%' },
  msgWrapperUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  msgWrapperSupport: { alignSelf: 'flex-start' },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F0F2F8', alignItems: 'center', justifyContent: 'center',
    marginRight: 8, marginTop: 4,
  },
  msgBubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: 260 },
  msgBubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  msgBubbleSupport: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#E8ECF4' },
  msgText: { fontSize: 15, lineHeight: 22 },
  msgTextUser: { color: '#fff' },
  msgTextSupport: { color: colors.textPrimary },
  msgImage: { width: 220, height: 220, borderRadius: 12, marginTop: 8 },
  msgTime: { fontSize: 10, color: colors.textLight, marginTop: 3, paddingHorizontal: 4 },
  pendingImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8ECF4',
    backgroundColor: '#fff',
  },
  pendingImageThumb: { width: 58, height: 58, borderRadius: 10, backgroundColor: '#F5F6FA' },
  pendingImageTitle: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  pendingImageSub: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  pendingImageActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pendingActionBtn: {
    borderWidth: 1,
    borderColor: '#CCD4E0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#fff',
  },
  pendingActionText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  pendingActionDanger: { borderColor: '#F1B1B1' },
  pendingActionDangerText: { color: '#B42318' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E8ECF4',
    gap: 8,
  },
  chatInput: {
    flex: 1, backgroundColor: '#F5F6FA', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: colors.textPrimary,
    maxHeight: 100, textAlignVertical: 'top',
  },
  attachBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  attachBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
});
