import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { BRAND, BG } from '../lib/config';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'OTP'>;

const RESEND_DELAY = 60;

export default function OTPScreen({ route, navigation }: Props) {
  const { phone, name, mode } = route.params;
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(RESEND_DELAY);
  const inputs = useRef<(TextInput | null)[]>([]);

  const { verifyOtp, sendOtp, isLoading, error, clearError } = useAuthStore();

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const code = digits.join('');
  const isComplete = code.length === 6;

  const handleDigit = (val: string, idx: number) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < 5) inputs.current[idx + 1]?.focus();
    if (!clean && idx > 0) inputs.current[idx - 1]?.focus();
  };

  const handleKeyPress = (key: string, idx: number) => {
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (!isComplete || isLoading) return;
    try {
      await verifyOtp(phone, code, name);
      // Navigation handled by App.tsx auth state change
    } catch {
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await sendOtp(phone);
      setResendTimer(RESEND_DELAY);
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } catch {
      Alert.alert('Erreur', 'Impossible de renvoyer le code.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.brand}>
        <Text style={styles.logo}>Vecto</Text>
        <Text style={styles.subtitle}>
          {mode === 'register' ? 'Créer un compte' : 'Connexion'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.info}>Code envoyé au</Text>
        <Text style={styles.phone}>{phone}</Text>

        <Text style={styles.label}>Entrez le code à 6 chiffres</Text>

        <View style={styles.digitRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => { inputs.current[i] = r; }}
              style={[styles.digitBox, d ? styles.digitBoxFilled : null]}
              value={d}
              onChangeText={(v) => handleDigit(v, i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              editable={!isLoading}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, (!isComplete || isLoading) && styles.btnOff]}
          onPress={handleVerify}
          disabled={!isComplete || isLoading}
          activeOpacity={0.8}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>
                {mode === 'register' ? 'Créer mon compte' : 'Se connecter'}
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resendBtn, resendTimer > 0 && styles.resendOff]}
          onPress={handleResend}
          disabled={resendTimer > 0 || isLoading}
        >
          <Text style={[styles.resendText, resendTimer > 0 && styles.resendTextOff]}>
            {resendTimer > 0 ? `Renvoyer (${resendTimer}s)` : 'Renvoyer le code'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          disabled={isLoading}
        >
          <Text style={styles.backText}>← Changer de numéro</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 28 },
  brand: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 52, fontWeight: '800', color: BRAND },
  subtitle: { color: '#888', fontSize: 16, marginTop: 4 },
  card: {
    backgroundColor: '#1e1e1e', borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: '#2a2a2a', gap: 14, alignItems: 'center',
  },
  info: { color: '#666', fontSize: 14 },
  phone: { color: BRAND, fontSize: 16, fontWeight: '600' },
  label: { color: '#aaa', fontSize: 13 },
  digitRow: { flexDirection: 'row', gap: 8, width: '100%' },
  digitBox: {
    flex: 1, height: 54, borderRadius: 12,
    backgroundColor: '#111', borderWidth: 1.5, borderColor: '#333',
    color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center',
  },
  digitBoxFilled: { borderColor: BRAND },
  error: { color: '#ff6b6b', fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', width: '100%', marginTop: 4,
  },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resendBtn: { paddingVertical: 4 },
  resendOff: {},
  resendText: { color: BRAND, fontSize: 14, fontWeight: '600' },
  resendTextOff: { color: '#555' },
  backBtn: { paddingVertical: 4 },
  backText: { color: '#555', fontSize: 13 },
});
