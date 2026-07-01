import { useEffect, useState } from 'react';
import { View } from 'react-native';
import SplashAnimation from './components/SplashAnimation';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './store/auth.store';
import LoginScreen from './screens/LoginScreen';
import OTPScreen from './screens/OTPScreen';
import SetupScreen from './screens/SetupScreen';
import RegisterScreen from './screens/RegisterScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import MainScreen from './screens/MainScreen';
import ChatScreen from './screens/ChatScreen';
import CallScreen from './screens/CallScreen';
import IncomingCallScreen from './screens/IncomingCallScreen';
import type { RootStackParamList } from './types';
import { BG, CARD, TEXT } from './lib/config';
import { useVoiceStore } from './store/voice.store';
import { navigationRef } from './lib/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { driver, isReady, initialize } = useAuthStore();
  const { init: initVoice, incomingInvite } = useVoiceStore();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => { initialize(); }, []);
  useEffect(() => { if (driver) initVoice(); }, [driver]);
  useEffect(() => {
    if (incomingInvite && navigationRef.isReady()) {
      navigationRef.navigate('IncomingCall');
    }
  }, [incomingInvite]);

  if (!splashDone || !isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
        <StatusBar style="dark" />
        {!splashDone && <SplashAnimation onFinish={() => setSplashDone(true)} />}
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Stack.Screen name="Main" component={MainScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Chat" component={ChatScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false, gestureEnabled: false, presentation: 'fullScreenModal' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Setup" component={SetupScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
