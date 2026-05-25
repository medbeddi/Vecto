import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { sendOtp } from '../lib/api';
import CountryPicker, { COUNTRIES, type Country } from '../components/CountryPicker';
import type { RootStackParamList } from '../App';

const BRAND = '#25D366';
const BG = '#0a0a0a';

export default function PhoneScreen() {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]); // Mauritanie par défaut
  const [local, setLocal] = useState('');
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const phone = `${country.dial}${local.replace(/\D/g, '')}`;
  const isValid = local.replace(/\D/g, '').length >= 6;

  const handleSend = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      await sendOtp(phone);
      navigation.navigate('OTP', { phone });
    } catch {
      Alert.alert('Erreur', 'Impossible d\'envoyer le code. Vérifiez votre numéro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.top}>
        <View style={s.logoCircle}>
          <Text style={s.logoIcon}>🛵</Text>
        </View>
        <Text style={s.logoText}>Vecto</Text>
        <Text style={s.sub}>Livraison rapide & anonyme</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Commencer une commande</Text>
        <Text style={s.cardDesc}>
          Entrez votre numéro WhatsApp. Un code de vérification vous sera envoyé.
        </Text>

        <View style={s.inputRow}>
          <CountryPicker selected={country} onSelect={setCountry} />
          <TextInput
            style={s.input}
            placeholder="XX XXX XXX"
            placeholderTextColor="#555"
            keyboardType="phone-pad"
            value={local}
            onChangeText={setLocal}
            returnKeyType="done"
            onSubmitEditing={handleSend}
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          style={[s.btn, (!isValid || loading) && s.btnOff]}
          disabled={!isValid || loading}
          onPress={handleSend}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Recevoir le code →</Text>
          }
        </TouchableOpacity>

        <Text style={s.hint}>🔒 Votre numéro est anonymisé — jamais partagé avec le livreur</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 24 },
  top: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: BRAND,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  logoIcon: { fontSize: 36 },
  logoText: { fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  sub: { color: '#666', fontSize: 14, marginTop: 4 },
  card: {
    backgroundColor: '#111', borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: '#222', gap: 14,
  },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cardDesc: { color: '#666', fontSize: 13, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 12,
    borderWidth: 1, borderColor: '#333', overflow: 'hidden',
  },
  input: { flex: 1, padding: 14, color: '#fff', fontSize: 16 },
  btn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  btnOff: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: '#444', fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
