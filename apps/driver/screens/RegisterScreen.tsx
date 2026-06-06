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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { PRIMARY, BG, TEXT, TEXT2, BORDER, BRAND } from '../lib/config';
import CountryPicker, { COUNTRIES, type Country } from '../components/CountryPicker';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [local, setLocal] = useState('');

  const { checkPhone, sendOtp, isLoading, error, clearError } = useAuthStore();
  const [localError, setLocalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const phone = `${country.dial}${local.replace(/\D/g, '')}`;
  const isValid = local.replace(/\D/g, '').length >= 6;
  const busy = isLoading || checking;

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleSend = async () => {
    if (!isValid || busy) return;
    setLocalError(null);
    setChecking(true);
    try {
      const exists = await checkPhone(phone);
      if (exists) {
        setLocalError('Ce numéro est déjà enregistré. Connectez-vous à la place.');
        setChecking(false);
        return;
      }
      setChecking(false);
      await sendOtp(phone);
      navigation.navigate('OTP', { phone, mode: 'register' });
    } catch {
      setChecking(false);
    }
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

      <View style={styles.form}>
        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.sub}>Entrez votre numéro pour recevoir un code de vérification</Text>

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
            autoFocus
          />
        </View>

        {(localError || error) ? (
          <Text style={styles.error}>{localError ?? error}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.btn, (!isValid || busy) && styles.btnOff]}
          onPress={handleSend}
          disabled={!isValid || busy}
          activeOpacity={0.8}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Recevoir le code →</Text>
          }
        </TouchableOpacity>

        <Text style={styles.hint}>Un code à 4 chiffres sera envoyé sur WhatsApp</Text>

        <View style={styles.divider} />

        <TouchableOpacity onPress={() => navigation.replace('Login')} disabled={busy}>
          <Text style={styles.switchText}>Déjà un compte ? <Text style={styles.switchLink}>Se connecter</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 28 },
  back: { position: 'absolute', top: 56, left: 24, padding: 8 },
  backText: { fontSize: 22, color: TEXT },
  form: { gap: 14 },
  title: { fontSize: 24, fontWeight: '800', color: TEXT },
  sub: { fontSize: 13, color: TEXT2, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#FAFAFA',
  },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, color: TEXT, fontSize: 16 },
  error: { color: BRAND, fontSize: 13 },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: TEXT2, fontSize: 12, textAlign: 'center' },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 4 },
  switchText: { color: TEXT2, fontSize: 13, textAlign: 'center' },
  switchLink: { color: PRIMARY, fontWeight: '700' },
});
