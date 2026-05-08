import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function PendingApprovalScreen() {
  const { user, logout, setUser } = useAuth();
  const { on } = useSocket();
  const isRejected = user?.verificationStatus === 'rejected';

  useEffect(() => {
    const unsubApproved = on('account_approved', async () => {
      try {
        const { data } = await userAPI.getMe();
        if (setUser) setUser(data.user);
      } catch {}
    });
    const unsubRejected = on('account_rejected', async ({ reason }) => {
      try {
        const { data } = await userAPI.getMe();
        if (setUser) setUser({ ...(data.user || user), verificationStatus: 'rejected', rejectionReason: reason });
      } catch {}
    });
    return () => { unsubApproved && unsubApproved(); unsubRejected && unsubRejected(); };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={['#0F1117', '#1A1A2E', '#16213E']}
        style={styles.bg}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.content}>
          <View style={[styles.iconRing, isRejected && styles.iconRingRejected]}>
            <View style={[styles.iconInner, isRejected && styles.iconInnerRejected]}>
              <Ionicons
                name={isRejected ? 'close-circle-outline' : 'shield-checkmark-outline'}
                size={52}
                color={isRejected ? '#FF6B00' : '#fff'}
              />
            </View>
          </View>

          <Text style={styles.title}>
            {isRejected ? 'Cadastro não aprovado' : 'Verificação em andamento'}
          </Text>

          <Text style={styles.subtitle}>
            {isRejected
              ? 'Infelizmente seu cadastro não pôde ser aprovado neste momento.'
              : 'Estamos verificando sua identidade para garantir a segurança de todos na plataforma.'}
          </Text>

          {isRejected && user?.rejectionReason && (
            <View style={styles.reasonBox}>
              <Ionicons name="information-circle-outline" size={18} color="#FF6B00" />
              <Text style={styles.reasonText}>
                <Text style={{ fontWeight: '700' }}>Motivo: </Text>
                {user.rejectionReason}
              </Text>
            </View>
          )}

          {!isRejected && (
            <>
              <View style={styles.stepsContainer}>
                <Step icon="checkmark-circle" label="Cadastro realizado" done />
                <Step icon="mail" label="E-mail verificado" done />
                <Step icon="document-text-outline" label="Documentos enviados" done />
                <Step icon="shield-checkmark-outline" label="Análise em andamento" active />
                <Step icon="star-outline" label="Conta aprovada" />
              </View>

              <View style={styles.infoCard}>
                <Ionicons name="time-outline" size={20} color="rgba(255,255,255,0.5)" />
                <Text style={styles.infoText}>
                  Você receberá um e-mail em até <Text style={{ color: '#FF8C38', fontWeight: '700' }}>24 horas</Text> com o resultado da análise.
                </Text>
              </View>
            </>
          )}

          {isRejected && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => setUser(prev => ({ ...prev, verificationStatus: 'pending_documents' }))}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={colors.gradientPrimary}
                style={styles.retryGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="reload-outline" size={18} color="#fff" />
                <Text style={styles.retryText}>Reenviar documentos</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
            <Text style={styles.logoutText}>Sair da conta</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const Step = ({ icon, label, done, active }) => (
  <View style={step.row}>
    <View style={[step.dot, done && step.dotDone, active && step.dotActive]}>
      <Ionicons
        name={done ? 'checkmark' : icon}
        size={14}
        color={done ? '#fff' : active ? '#FF6B00' : 'rgba(255,255,255,0.2)'}
      />
    </View>
    <Text style={[step.label, done && step.labelDone, active && step.labelActive]}>
      {label}
    </Text>
  </View>
);

const step = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  dotDone: { backgroundColor: '#00C853', borderColor: '#00C853' },
  dotActive: { backgroundColor: 'rgba(255,107,0,0.15)', borderColor: '#FF6B00' },
  label: { fontSize: 14, color: 'rgba(255,255,255,0.3)', fontFamily: 'System' },
  labelDone: { color: 'rgba(255,255,255,0.7)' },
  labelActive: { color: '#FF8C38', fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  bg: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 40,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,107,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.2)',
  },
  iconRingRejected: {
    backgroundColor: 'rgba(255,107,0,0.06)',
    borderColor: 'rgba(255,107,0,0.3)',
  },
  iconInner: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,107,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInnerRejected: {
    backgroundColor: 'rgba(255,107,0,0.1)',
  },
  title: {
    fontSize: typography.fontSizes.xxxl,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 320,
  },
  stepsContainer: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    width: '100%',
  },
  infoText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 20,
  },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,107,0,0.08)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.2)',
    width: '100%',
  },
  reasonText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 20,
  },
  retryBtn: { width: '100%', borderRadius: borderRadius.lg, overflow: 'hidden', marginBottom: 16 },
  retryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  retryText: { color: '#fff', fontSize: typography.fontSizes.md, fontWeight: '700' },
  logoutBtn: { paddingVertical: 10 },
  logoutText: { fontSize: typography.fontSizes.sm, color: 'rgba(255,255,255,0.3)', textDecorationLine: 'underline' },
});
