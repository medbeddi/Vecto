import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './store/auth.store';
import LoginScreen from './screens/LoginScreen';
import OTPScreen from './screens/OTPScreen';
import MainScreen from './screens/MainScreen';
import ChatScreen from './screens/ChatScreen';
import type { RootStackParamList } from './types';
import { PRIMARY, BG, CARD, BORDER, TEXT } from './lib/config';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { driver, isReady, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: CARD },
          headerTintColor: TEXT,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: BG },
        }}
      >
        {driver ? (
          <>
            <Stack.Screen
              name="Main"
              component={MainScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={({ route }) => ({
                title: route.params.delivery.clientAlias,
                headerBackTitle: 'Retour',
                headerStyle: { backgroundColor: CARD },
                headerTintColor: TEXT,
                headerBottomBorderColor: BORDER,
              })}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
