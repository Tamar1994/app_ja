import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OnboardingScreen from '../screens/auth/OnboardingScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import DocumentUploadScreen from '../screens/auth/DocumentUploadScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';
import AcceptTermsScreen from '../screens/auth/AcceptTermsScreen';
import ProfessionalAddressScreen from '../screens/auth/ProfessionalAddressScreen';

const Stack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <Stack.Screen name="AcceptTerms" component={AcceptTermsScreen} />
      <Stack.Screen name="ProfessionalAddress" component={ProfessionalAddressScreen} />
      <Stack.Screen name="DocumentUpload" component={DocumentUploadScreen} />
      <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
    </Stack.Navigator>
  );
}
