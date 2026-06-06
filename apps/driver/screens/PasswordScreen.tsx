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
import { PRIMARY, BG, TEXT, TEXT2, BORDER, BRAND } from '../lib/config';
import CountryPicker, { COUNTRIES, type Country } from '../components/CountryPicker';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Password'>;

export default function PasswordScreen({ navigation }: Props) {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [local, setLocal] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);

  const { loginWithPassword, sendOtp, isLoading, error, clearError } = useAuthStore();

  const phone = `${country.dial}${local.replace(/\D/g, '')}`;
  const isValid = local.replace(/\D/g, '').length >= 6 && password.length >= 1;

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleLogin = async () => {
    if (!isValid || isLoading) return;
    try {
      await loginWithPassword(phone, password);
    } catch {}
  };

  const handleForgot = () => {
    if (isLoading || local.replace(/\D/g, '').length < 6) {
      Alert.alert('Numéro requis', 'Entrez d\'abord votre numéro de téléphone.');
      return;
    }
    Alert.alert(
      'Mot de passe oublié',
      `Envoyer un code de vérification au ${phone} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer le code',
          onPress: async () => {
            try {
              await sendOtp(phone);
              navigation.navigate('OTP', { phone, mode: 'reset' });
            } catch {}
          },
        },
      ]
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

      <View style={styles.form}>
        <Text style={styles.title}>Se connecter</Text>
        <Text style={styles.sub}>Entrez votre numéro et mot de passe</Text>

        <View style={styles.inputRow}>
          <CountryPicker selected={country} onSelect={setCountry} light />
          <TextInput
            style={styles.input}
            placeholder="XX XX XX XX"
            placeholderTextColor={TEXT2}
            keyboardType="phone-pad"
            value={local}
            onChangeText={setLocal}
            returnKeyType="next"
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            style={styles.inputFlex}
            placeholder="Mot de passe"
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
          style={[styles.btn, (!isValid || isLoading) && styles.btnOff]}
          onPress={handleLogin}
          disabled={!isValid || isLoading}
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

        <View style={styles.divider} />

        <TouchableOpacity onPress={() => navigation.replace('Register')} disabled={isLoading}>
          <Text style={styles.switchText}>Pas encore de compte ? <Text style={styles.switchLink}>Créer un compte</Text></Text>
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
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    backgroundColor: '#FAFAFA', overflow: 'hidden',
  },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, color: TEXT, fontSize: 16 },
  inputFlex: { flex: 1, paddingVertical: 14, paddingHorizontal: 14, color: TEXT, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 12 },
  error: { color: BRAND, fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  forgot: { color: TEXT2, fontSize: 13, textDecorationLine: 'underline', textAlign: 'center' },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 4 },
  switchText: { color: TEXT2, fontSize: 13, textAlign: 'center' },
  switchLink: { color: PRIMARY, fontWeight: '700' },
});
