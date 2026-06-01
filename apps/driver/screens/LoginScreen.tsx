import { useEffect, useState } from 'react';
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
import { PRIMARY, BG, CARD, TEXT, TEXT2, BORDER, BRAND } from '../lib/config';
import CountryPicker, { COUNTRIES, type Country } from '../components/CountryPicker';
import type { RootStackParamList } from '../types';

export default function LoginScreen() {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [local, setLocal] = useState('');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { sendOtp, isLoading, error, clearError } = useAuthStore();

  const phone = `${country.dial}${local.replace(/\D/g, '')}`;
  const isValid = local.replace(/\D/g, '').length >= 6;

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleSend = async () => {
    if (!isValid || isLoading) return;
    try {
      await sendOtp(phone);
      navigation.navigate('OTP', { phone, mode: 'login' });
    } catch {}
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />

      {/* Logo */}
      <View style={styles.logoBlock}>
        <View style={styles.logoSquare}>
          <Text style={styles.logoLetter}>V</Text>
        </View>
        <Text style={styles.logoText}>VECTO</Text>
        <Text style={styles.logoSub}>Espace Livreur</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <Text style={styles.welcome}>Bienvenue 👋</Text>
        <Text style={styles.desc}>Connectez-vous pour recevoir des courses</Text>

        <View style={styles.inputRow}>
          <CountryPicker selected={country} onSelect={setCountry} light />
          <TextInput
            style={styles.input}
            placeholder="XX XX XX XX"
            placeholderTextColor={TEXT2}
            keyboardType="phone-pad"
            value={local}
            onChangeText={setLocal}
            returnKeyType="done"
            onSubmitEditing={handleSend}
            editable={!isLoading}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, (!isValid || isLoading) && styles.btnOff]}
          onPress={handleSend}
          disabled={!isValid || isLoading}
          activeOpacity={0.8}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Recevoir le code →</Text>
          }
        </TouchableOpacity>

        <Text style={styles.hint}>Un code de vérification vous sera envoyé</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 24 },
  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logoSquare: {
    width: 60, height: 60, borderRadius: 14,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
  },
  logoLetter: { color: '#fff', fontSize: 30, fontWeight: '900' },
  logoText: { fontSize: 22, fontWeight: '900', color: PRIMARY, letterSpacing: 3 },
  logoSub: { fontSize: 13, color: TEXT2, marginTop: 2, letterSpacing: 1 },
  card: {
    backgroundColor: CARD, borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, gap: 14,
  },
  welcome: { fontSize: 22, fontWeight: '800', color: TEXT, textAlign: 'center' },
  desc: { fontSize: 13, color: TEXT2, textAlign: 'center', lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#FAFAFA',
  },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, color: TEXT, fontSize: 16 },
  error: { color: BRAND, textAlign: 'center', fontSize: 13 },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: TEXT2, fontSize: 12, textAlign: 'center' },
});
