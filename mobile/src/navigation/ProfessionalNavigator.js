import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import DashboardScreen from '../screens/professional/DashboardScreen';
import ActiveJobScreen from '../screens/professional/ActiveJobScreen';
import HistoryScreen from '../screens/professional/HistoryScreen';
import EarningsScreen from '../screens/professional/EarningsScreen';
import ProfileScreen from '../screens/professional/ProfileScreen';
import SecurityScreen from '../screens/shared/SecurityScreen';
import TermsScreen from '../screens/shared/TermsScreen';
import CouponWalletScreen from '../screens/shared/CouponWalletScreen';
import HelpCenterScreen from '../screens/client/HelpCenterScreen';
import SupportChatScreen from '../screens/client/SupportChatScreen';
import ServiceChatScreen from '../screens/shared/ServiceChatScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="ActiveJob" component={ActiveJobScreen} />
      <Stack.Screen name="ServiceChat" component={ServiceChatScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Security" component={SecurityScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="CouponWallet" component={CouponWalletScreen} />
      <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
      <Stack.Screen name="SupportChat" component={SupportChatScreen} />
    </Stack.Navigator>
  );
}

export default function ProfessionalNavigator() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 6);
  const tabBarHeight = 58 + bottomPad;
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
          if (route.name === 'DashboardTab') iconName = focused ? 'grid' : 'grid-outline';
          else if (route.name === 'EarningsTab') iconName = focused ? 'wallet' : 'wallet-outline';
          else if (route.name === 'HistoryTab') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'ProfileTab') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="DashboardTab" component={DashboardStack} options={{ title: 'Serviços' }} />
      <Tab.Screen name="EarningsTab" component={EarningsScreen} options={{ title: 'Carteira' }} />
      <Tab.Screen name="HistoryTab" component={HistoryScreen} options={{ title: 'Histórico' }} />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: 'Perfil' }} />
    </Tab.Navigator>
  );
}
