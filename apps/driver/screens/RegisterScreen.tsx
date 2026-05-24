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

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { register, isLoading, error, clearError } = useAuthStore();

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleRegister = () => {
    if (!name.trim() || !phone.trim() || !password || !confirm) return;
    if (password !== confirm) return;
    register(name.trim(), phone.trim(), password);
  };

  const isValid = name && phone && password && confirm && password === confirm;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.brand}>
        <Text style={styles.logo}>Vecto</Text>
        <Text style={styles.subtitle}>Créer un compte livreur</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Nom complet"
          placeholderTextColor="#555"
          value={name}
          onChangeText={setName}
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          editable={!isLoading}
        />

        <TextInput
          ref={phoneRef}
          style={styles.input}
          placeholder="Téléphone (+222 XX XX XX XX)"
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
          placeholder="Mot de passe (min. 6 caractères)"
          placeholderTextColor="#555"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          editable={!isLoading}
        />

        <TextInput
          ref={confirmRef}
          style={[styles.input, confirm && password !== confirm && styles.inputError]}
          placeholder="Confirmer le mot de passe"
          placeholderTextColor="#555"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
          returnKeyType="done"
          onSubmitEditing={handleRegister}
          editable={!isLoading}
        />

        {confirm && password !== confirm ? (
          <Text style={styles.error}>Les mots de passe ne correspondent pas</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.btn, (!isValid || isLoading) && styles.btnOff]}
          onPress={handleRegister}
          disabled={!isValid || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Créer mon compte</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => navigation.goBack()}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>Déjà un compte ? <Text style={styles.linkBold}>Se connecter</Text></Text>
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
  brand: { alignItems: 'center', marginBottom: 40 },
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
  inputError: { borderColor: '#ff6b6b' },
  error: { color: '#ff6b6b', textAlign: 'center', fontSize: 14 },
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
