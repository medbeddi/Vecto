import { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'OTP'>;


const RESEND_DELAY = 60;
const CODE_LENGTH = 4;

export default function OTPScreen({ route, navigation }: Props) {
  const { phone, mode = 'register' } = route.params;
  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [resendTimer, setResendTimer] = useState(RESEND_DELAY);
  const inputs = useRef<(TextInput | null)[]>([]);

  const { sendOtp, isLoading } = useAuthStore();

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const code = digits.join('');
  const isComplete = code.length === CODE_LENGTH;

  const handleDigit = (val: string, idx: number) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < CODE_LENGTH - 1) inputs.current[idx + 1]?.focus();
    if (!clean && idx > 0) inputs.current[idx - 1]?.focus();
  };

  const handleKeyPress = (key: string, idx: number) => {
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const handleNext = () => {
    if (!isComplete) return;
    if (mode === 'reset') {
      navigation.navigate('ResetPassword', { phone, code });
    } else {
      navigation.navigate('Setup', { phone, code });
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await sendOtp(phone);
      setResendTimer(RESEND_DELAY);
      setDigits(Array(CODE_LENGTH).fill(''));
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
      <StatusBar style="dark" />

      {/* Back */}
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} disabled={isLoading}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      {/* Card */}
      <View style={styles.form}>
        <Text style={styles.title}>{mode === 'reset' ? 'Réinitialisation' : 'Vérification'}</Text>
        <Text style={styles.sub}>Code envoyé au <Text style={styles.phone}>{phone}</Text></Text>

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

        <TouchableOpacity
          style={[styles.btn, !isComplete && styles.btnOff]}
          onPress={handleNext}
          disabled={!isComplete}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>Confirmer</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResend} disabled={resendTimer > 0 || isLoading}>
          <Text style={[styles.resend, resendTimer > 0 && styles.resendOff]}>
            {resendTimer > 0
              ? `Renvoyer le code dans ${resendTimer}s`
              : 'Renvoyer le code'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 24 },
  back: { position: 'absolute', top: 56, left: 24, padding: 8 },
  backText: { fontSize: 22, color: TEXT },
  form: { alignItems: 'center', gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: TEXT },
  sub: { fontSize: 14, color: TEXT2 },
  phone: { fontSize: 15, fontWeight: '700', color: TEXT },
  digitRow: { flexDirection: 'row', gap: 12, marginVertical: 8 },
  digitBox: {
    width: 60, height: 64, borderRadius: 14,
    borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: '#FAFAFA',
    color: TEXT, fontSize: 26, fontWeight: '800', textAlign: 'center',
  },
  digitBoxFilled: { borderColor: PRIMARY, backgroundColor: '#fff' },
  error: { color: BRAND, fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', width: '100%', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resend: { color: PRIMARY, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  resendOff: { color: TEXT2 },
});
