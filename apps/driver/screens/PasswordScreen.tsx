import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { PRIMARY, BG, CARD, TEXT, TEXT2, BORDER, BRAND } from '../lib/config';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Password'>;

export default function PasswordScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);

  const { loginWithPassword, isLoading, error, clearError } = useAuthStore();

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleLogin = async () => {
    if (!password || isLoading) return;
    try {
      await loginWithPassword(phone, password);
    } catch {}
  };

  const handleForgot = () => {
    Alert.alert(
      'Mot de passe oublié',
      'Contactez l\'administrateur pour réinitialiser votre mot de passe.',
      [{ text: 'OK' }]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />

      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} disabled={isLoading}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.title}>Mot de passe</Text>
        <Text style={styles.sub}>Numéro enregistré</Text>
        <Text style={styles.phone}>{phone}</Text>

        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Votre mot de passe"
            placeholderTextColor={TEXT2}
            secureTextEntry={secure}
            value={password}
            onChangeText={setPassword}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            editable={!isLoading}
            autoFocus
          />
          <TouchableOpacity onPress={() => setSecure((s) => !s)} style={styles.eyeBtn}>
            <Icon name={secure ? 'eye' : 'eye-off'} size={20} color={TEXT2} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, (!password || isLoading) && styles.btnOff]}
          onPress={handleLogin}
          disabled={!password || isLoading}
          activeOpacity={0.8}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Se connecter</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={handleForgot} disabled={isLoading}>
          <Text style={styles.forgot}>Mot de passe oublié ?</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 24 },
  back: { position: 'absolute', top: 56, left: 24, padding: 8 },
  backText: { fontSize: 22, color: TEXT },
  card: {
    backgroundColor: CARD, borderRadius: 20, padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, gap: 14,
  },
  title: { fontSize: 24, fontWeight: '800', color: TEXT },
  sub: { fontSize: 14, color: TEXT2 },
  phone: { fontSize: 15, fontWeight: '700', color: TEXT },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    backgroundColor: '#FAFAFA', overflow: 'hidden',
  },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 14, color: TEXT, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 12 },
  error: { color: BRAND, fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', width: '100%', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  forgot: { color: TEXT2, fontSize: 13, textDecorationLine: 'underline' },
});
