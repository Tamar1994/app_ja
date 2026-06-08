import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, StatusBar, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { adminSupportAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { connectAdminSocket, disconnectAdminSocket, getAdminSocket } from '../services/socket';
import { colors, spacing, borderRadius, typography } from '../theme';

const POLL_MS = 10000;

function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function ChatCard({ chat, onPress }) {
  const isP1 = chat.priority === 'p1';
  const lastMsg = chat.messages?.length
    ? chat.messages[chat.messages.length - 1]
    : null;

  return (
    <TouchableOpacity
      style={[styles.chatCard, isP1 && styles.chatCardP1]}
      onPress={() => onPress(chat)}
      activeOpacity={0.8}
    >
      {isP1 && (
        <View style={styles.p1Banner}>
          <Ionicons name="warning" size={12} color={colors.white} />
          <Text style={styles.p1BannerText}>PRIORIDADE 1 — EMERGÊNCIA</Text>
        </View>
      )}
      <View style={styles.chatCardBody}>
        <View style={styles.chatCardLeft}>
          <View style={[styles.avatar, isP1 && styles.avatarP1]}>
            <Text style={styles.avatarText}>
              {(chat.userId?.name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.chatCardInfo}>
          <View style={styles.chatCardRow}>
            <Text style={styles.chatUserName} numberOfLines={1}>
              {chat.userId?.name || 'Usuário'}
            </Text>
            <Text style={styles.chatTime}>{timeSince(chat.assignedAt || chat.queuedAt)}</Text>
          </View>
          <Text style={styles.chatSubject} numberOfLines={1}>{chat.subject || 'Sem assunto'}</Text>
          {lastMsg && (
            <Text style={styles.chatLastMsg} numberOfLines={1}>
              {lastMsg.sender === 'support' ? 'Você: ' : ''}{lastMsg.text || '[imagem]'}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
      </View>
    </TouchableOpacity>
  );
}

export default function ChatListScreen({ navigation }) {
  const { admin, token, logout } = useAuth();
  const [chats, setChats] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const pollRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [chatsRes, statusRes] = await Promise.all([
        adminSupportAPI.myChats(),
        adminSupportAPI.getStatus(),
      ]);
      // P1 primeiro, depois por data de atribuição
      const sorted = (chatsRes.data.chats || []).sort((a, b) => {
        if (a.priority === 'p1' && b.priority !== 'p1') return -1;
        if (b.priority === 'p1' && a.priority !== 'p1') return 1;
        return new Date(b.assignedAt) - new Date(a.assignedAt);
      });
      setChats(sorted);
      setIsOnline(statusRes.data.supportStatus === 'online');
    } catch {
      // silencioso
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Socket para receber novos chats em tempo real
  useEffect(() => {
    const socket = connectAdminSocket(token);

    socket.on('chat_assigned', () => fetchData(true));
    socket.on('support_p1_alert', () => {
      fetchData(true);
    });
    socket.on('support_message', () => fetchData(true));

    return () => {
      socket.off('chat_assigned');
      socket.off('support_p1_alert');
      socket.off('support_message');
    };
  }, [token, fetchData]);

  // Polling de fundo
  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(() => fetchData(true), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  // Pausar polling quando app vai para background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && appStateRef.current !== 'active') {
        fetchData(true);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => fetchData(true), POLL_MS);
        }
      } else if (state !== 'active') {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      appStateRef.current = state;
    });
    return () => sub.remove();
  }, [fetchData]);

  const handleToggleStatus = async () => {
    setTogglingStatus(true);
    try {
      const res = await adminSupportAPI.toggleStatus();
      setIsOnline(res.data.supportStatus === 'online');
      if (res.data.supportStatus === 'online') fetchData(true);
    } catch {
      Alert.alert('Erro', 'Não foi possível alterar o status.');
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja sair do painel de suporte?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          disconnectAdminSocket();
          logout();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} translucent={false} />

      {/* Header */}
      <LinearGradient colors={colors.gradientPrimary} style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>Suporte</Text>
            <Text style={styles.headerSub}>Olá, {admin?.name?.split(' ')[0] || 'Admin'}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>

        {/* Status badge */}
        <TouchableOpacity
          style={[styles.statusBtn, isOnline ? styles.statusOnline : styles.statusOffline]}
          onPress={handleToggleStatus}
          disabled={togglingStatus}
          activeOpacity={0.8}
        >
          {togglingStatus
            ? <ActivityIndicator size="small" color={colors.white} />
            : <>
                <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.success : 'rgba(255,255,255,0.5)' }]} />
                <Text style={styles.statusText}>
                  {isOnline ? 'Online — recebendo chats' : 'Offline — toque para ficar online'}
                </Text>
                <Ionicons name="swap-horizontal" size={14} color="rgba(255,255,255,0.8)" />
              </>
          }
        </TouchableOpacity>
      </LinearGradient>

      {/* Contadores */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{chats.length}</Text>
          <Text style={styles.statLabel}>Meus ativos</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxDivider]}>
          <Text style={[styles.statValue, { color: colors.p1 }]}>
            {chats.filter(c => c.priority === 'p1').length}
          </Text>
          <Text style={styles.statLabel}>Prioridade 1</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {chats.filter(c => c.messages?.some(m => m.sender === 'support')).length}
          </Text>
          <Text style={styles.statLabel}>Respondidos</Text>
        </View>
      </View>

      {/* Lista */}
      {chats.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubble-outline" size={56} color={colors.border} />
          <Text style={styles.emptyTitle}>Nenhum chat ativo</Text>
          <Text style={styles.emptyText}>
            {isOnline
              ? 'Aguardando novos atendimentos...'
              : 'Fique online para receber atendimentos.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => String(item._id)}
          renderItem={({ item }) => (
            <ChatCard
              chat={item}
              onPress={(chat) => navigation.navigate('ChatDetail', { chatId: chat._id })}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchData()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: colors.white,
  },
  headerSub: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: borderRadius.full,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  statusOnline: { backgroundColor: 'rgba(0,200,83,0.25)' },
  statusOffline: { backgroundColor: 'rgba(255,255,255,0.15)' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, color: colors.white, fontSize: typography.fontSizes.sm, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  statBoxDivider: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.primary,
  },
  statLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  list: { padding: spacing.md, gap: spacing.sm },
  chatCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatCardP1: {
    borderColor: colors.p1,
    borderWidth: 1.5,
  },
  p1Banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.p1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  p1BannerText: {
    color: colors.white,
    fontSize: typography.fontSizes.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  chatCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  chatCardLeft: { justifyContent: 'center' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarP1: { backgroundColor: colors.p1 },
  avatarText: { color: colors.white, fontSize: typography.fontSizes.lg, fontWeight: '700' },
  chatCardInfo: { flex: 1 },
  chatCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatUserName: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  chatTime: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    marginLeft: 6,
  },
  chatSubject: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chatLastMsg: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    marginTop: 3,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptyText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
    textAlign: 'center',
  },
});
