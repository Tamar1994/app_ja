import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import ProfessionalNavigator from './ProfessionalNavigator';
import DocumentUploadScreen from '../screens/auth/DocumentUploadScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator size="large" color={colors.white} />
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
