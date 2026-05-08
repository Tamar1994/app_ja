import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import ProfessionalNavigator from './ProfessionalNavigator';
import DocumentUploadScreen from '../screens/auth/DocumentUploadScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { user, loading, networkError, retryAuth } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  if (networkError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="cloud-offline-outline" size={64} color={colors.textLight} />
        <Text style={styles.errorTitle}>Sem conexão</Text>
        <Text style={styles.errorSub}>Não foi possível conectar ao servidor.{'\n'}Verifique sua internet e tente novamente.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={retryAuth}>
          <Ionicons name="refresh-outline" size={18} color={colors.white} />
          <Text style={styles.retryText}>Tentar novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderMain = () => {
    if (!user) return <AuthNavigator />;
    if (!user.isEmailVerified) return <AuthNavigator />;
    if (user.verificationStatus === 'pending_documents') return <DocumentUploadScreen />;
    if (user.verificationStatus === 'pending_review') return <PendingApprovalScreen />;
    if (user.verificationStatus === 'rejected') return <PendingApprovalScreen />;
    // approved
    return user.userType === 'client' ? <ClientNavigator /> : <ProfessionalNavigator />;
  };

  return (
    <NavigationContainer>
      {renderMain()}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  errorSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 8,
  },
  retryText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
