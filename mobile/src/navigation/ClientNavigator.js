import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import HomeScreen from '../screens/client/HomeScreen';
import RequestServiceScreen from '../screens/client/RequestServiceScreen';
import PaymentScreen from '../screens/client/PaymentScreen';
import PixCheckoutScreen from '../screens/client/PixCheckoutScreen';
import SearchingScreen from '../screens/client/SearchingScreen';
import TrackingScreen from '../screens/client/TrackingScreen';
import HistoryScreen from '../screens/client/HistoryScreen';
import ProfileScreen from '../screens/client/ProfileScreen';
import ReviewScreen from '../screens/client/ReviewScreen';
import HelpCenterScreen from '../screens/client/HelpCenterScreen';
import SupportChatScreen from '../screens/client/SupportChatScreen';
import ProfessionalFoundScreen from '../screens/client/ProfessionalFoundScreen';
import WalletScreen from '../screens/client/WalletScreen';
import SecurityScreen from '../screens/shared/SecurityScreen';
import ResidenceProofUploadScreen from '../screens/shared/ResidenceProofUploadScreen';
import TermsScreen from '../screens/shared/TermsScreen';
import CouponWalletScreen from '../screens/shared/CouponWalletScreen';
import ServiceChatScreen from '../screens/shared/ServiceChatScreen';
import RequestDetailsScreen from '../screens/shared/RequestDetailsScreen';
import ProfessionalUpgradeScreen from '../screens/auth/ProfessionalUpgradeScreen';
import ProfessionalAddressScreen from '../screens/auth/ProfessionalAddressScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="RequestService" component={RequestServiceScreen} />
      <Stack.Screen name="Payment" component={PaymentScreen} />
      <Stack.Screen name="PixCheckout" component={PixCheckoutScreen} />
      <Stack.Screen name="Searching" component={SearchingScreen} />
      <Stack.Screen name="ProfessionalFound" component={ProfessionalFoundScreen} />
      <Stack.Screen name="Tracking" component={TrackingScreen} />
      <Stack.Screen name="ServiceChat" component={ServiceChatScreen} />
      <Stack.Screen name="RequestDetails" component={RequestDetailsScreen} />
      <Stack.Screen name="Review" component={ReviewScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="CouponWallet" component={CouponWalletScreen} />
      <Stack.Screen name="Security" component={SecurityScreen} />
    </Stack.Navigator>
  );
}

function SupportStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
      <Stack.Screen name="SupportChat" component={SupportChatScreen} />
    </Stack.Navigator>
  );
}

export default function ClientNavigator() {
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : 6;
  const tabBarHeight = 58 + bottomPad;

  function ProfileStack() {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Security" component={SecurityScreen} />
        <Stack.Screen name="Terms" component={TermsScreen} />
        <Stack.Screen name="CouponWallet" component={CouponWalletScreen} />
        <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
        <Stack.Screen name="ResidenceProofUpload" component={ResidenceProofUploadScreen} />
        <Stack.Screen name="ProfessionalUpgrade" component={ProfessionalUpgradeScreen} />
        <Stack.Screen name="ProfessionalAddress" component={ProfessionalAddressScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          paddingBottom: bottomPad,
          paddingTop: 4,
          height: tabBarHeight,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'HomeTab') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'HistoryTab') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'SupportTab') iconName = focused ? 'help-circle' : 'help-circle-outline';
          else if (route.name === 'ProfileTab') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={{ title: 'Início' }} />
      <Tab.Screen name="HistoryTab" component={HistoryScreen} options={{ title: 'Histórico' }} />
      <Tab.Screen name="SupportTab" component={SupportStack} options={{ title: 'Suporte' }} />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: 'Perfil' }} />
    </Tab.Navigator>
  );
}
