import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { BRAND, BG } from '../lib/config';
import type { RootStackParamList } from '../types';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<TextInput>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { login, isLoading, error, clearError } = useAuthStore();

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleLogin = () => {
    if (!phone.trim() || !password.trim()) return;
    login(phone.trim(), password);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.brand}>
        <Text style={styles.logo}>Vecto</Text>
        <Text style={styles.subtitle}>Espace Livreur</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Téléphone  (+222 XX XX XX XX)"
          placeholderTextColor="#555"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!isLoading}
        />

        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="Mot de passe"
          placeholderTextColor="#555"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
          editable={!isLoading}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, (!phone || !password || isLoading) && styles.btnOff]}
          onPress={handleLogin}
          disabled={!phone || !password || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Connexion</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => navigation.navigate('Register')}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>Pas encore de compte ? <Text style={styles.linkBold}>Créer un compte</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    padding: 28,
  },
  brand: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 52, fontWeight: '800', color: BRAND },
  subtitle: { color: '#888', fontSize: 16, marginTop: 4 },
  form: { gap: 14 },
  input: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    fontSize: 14,
  },
  btn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  linkBtn: { alignItems: 'center', marginTop: 8 },
  linkText: { color: '#888', fontSize: 14 },
  linkBold: { color: BRAND, fontWeight: '600' },
});
