import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { sendOtp, verifyOtpClient, setClientToken } from '../lib/api';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'OTP'>;

const BRAND = '#25D366';
const BG = '#0a0a0a';
const RESEND_DELAY = 60;

export default function OTPScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(RESEND_DELAY);
  const inputs = useRef<(TextInput | null)[]>([]);

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
    if (!isComplete || loading) return;
    setLoading(true);
    try {
      const data = await verifyOtpClient(phone, code);
      setClientToken(data.token);
      navigation.replace('Home');
    } catch (err: any) {
      const msg = err?.message === 'INVALID_OR_EXPIRED_CODE'
        ? 'Code incorrect ou expiré. Réessayez.'
        : 'Erreur de vérification. Réessayez.';
      Alert.alert('Erreur', msg);
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
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
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.top}>
        <View style={s.logoCircle}>
          <Text style={s.logoIcon}>🔐</Text>
        </View>
        <Text style={s.title}>Vérification</Text>
        <Text style={s.sub}>Code envoyé au</Text>
        <Text style={s.phone}>{phone}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Entrez le code à 6 chiffres</Text>

        <View style={s.digitRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => { inputs.current[i] = r; }}
              style={[s.digitBox, d ? s.digitBoxFilled : null]}
              value={d}
              onChangeText={(v) => handleDigit(v, i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              editable={!loading}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[s.btn, (!isComplete || loading) && s.btnOff]}
          disabled={!isComplete || loading}
          onPress={handleVerify}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Confirmer →</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.resendBtn, resendTimer > 0 && s.resendOff]}
          onPress={handleResend}
          disabled={resendTimer > 0}
        >
          <Text style={[s.resendText, resendTimer > 0 && s.resendTextOff]}>
            {resendTimer > 0
              ? `Renvoyer le code (${resendTimer}s)`
              : 'Renvoyer le code'
            }
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>← Changer de numéro</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 24 },
  top: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: BRAND,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  logoIcon: { fontSize: 30 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 6 },
  sub: { color: '#666', fontSize: 14 },
  phone: { color: BRAND, fontSize: 16, fontWeight: '600', marginTop: 2 },
  card: {
    backgroundColor: '#111', borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: '#222', gap: 16,
  },
  label: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  digitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  digitBox: {
    flex: 1, height: 54, borderRadius: 12,
    backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#333',
    color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center',
  },
  digitBoxFilled: { borderColor: BRAND },
  btn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  btnOff: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resendBtn: { alignItems: 'center', paddingVertical: 4 },
  resendOff: {},
  resendText: { color: BRAND, fontSize: 14, fontWeight: '600' },
  resendTextOff: { color: '#555' },
  backBtn: { alignItems: 'center', paddingVertical: 4 },
  backText: { color: '#555', fontSize: 13 },
});
