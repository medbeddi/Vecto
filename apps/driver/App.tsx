import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './store/auth.store';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import OTPScreen from './screens/OTPScreen';
import DeliveriesScreen from './screens/DeliveriesScreen';
import ChatScreen from './screens/ChatScreen';
import type { RootStackParamList } from './types';
import { BRAND, BG } from './lib/config';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { driver, isReady, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  // Attente de la vérification du token stocké
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={BRAND} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1e1e1e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: BG },
        }}
      >
        {driver ? (
          // ─── Livreur connecté ─────────────────────────────────────────
          <>
            <Stack.Screen
              name="Deliveries"
              component={DeliveriesScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={({ route }) => ({
                title: route.params.delivery.clientAlias,
                headerBackTitle: 'Courses',
              })}
            />
          </>
        ) : (
          // ─── Non connecté ─────────────────────────────────────────────
          <>
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Register"
              component={RegisterScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OTP"
              component={OTPScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
