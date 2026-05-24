import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import PhoneScreen from './screens/PhoneScreen';
import ChatScreen from './screens/ChatScreen';

export type RootStackParamList = {
  Phone: undefined;
  Chat: { phone: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1e1e1e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#111111' },
        }}
      >
        <Stack.Screen name="Phone" component={PhoneScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Vecto — Ma commande' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
