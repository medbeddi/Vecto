import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { BRAND, BG } from '../lib/config';
import CountryPicker, { COUNTRIES, type Country } from '../components/CountryPicker';
import type { RootStackParamList } from '../types';

export default function LoginScreen() {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]); // Mauritanie par défaut
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
      <StatusBar style="light" />

      <View style={styles.brand}>
        <Text style={styles.logo}>Vecto</Text>
        <Text style={styles.subtitle}>Espace Livreur</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.desc}>
          Entrez votre numéro pour recevoir un code de vérification.
        </Text>

        <View style={styles.inputRow}>
          <CountryPicker selected={country} onSelect={setCountry} />
          <TextInput
            style={styles.input}
            placeholder="XX XXX XXX"
            placeholderTextColor="#555"
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

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => navigation.navigate('Register')}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>
            Nouveau livreur ?{' '}
            <Text style={styles.linkBold}>Créer un compte</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 28 },
  brand: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 52, fontWeight: '800', color: BRAND },
  subtitle: { color: '#888', fontSize: 16, marginTop: 4 },
  form: { gap: 14 },
  desc: { color: '#666', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e1e1e', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden',
  },
  input: { flex: 1, padding: 16, color: '#fff', fontSize: 16 },
  error: { color: '#ff6b6b', textAlign: 'center', fontSize: 14 },
  btn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 6,
  },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  linkBtn: { alignItems: 'center', marginTop: 8 },
  linkText: { color: '#888', fontSize: 14 },
  linkBold: { color: BRAND, fontWeight: '600' },
});
