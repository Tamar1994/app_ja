import 'react-native-gesture-handler';
import React from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import RootNavigator from './src/navigation';

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SocketProvider>
          <RootNavigator />
          <StatusBar style="auto" />
        </SocketProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

export default App;
registerRootComponent(App);
