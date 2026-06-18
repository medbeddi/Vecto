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
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({ route, navigation }: Props) {
  const { phone, code } = route.params;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { resetPassword, isLoading, error, clearError } = useAuthStore();

  useEffect(() => {
    clearError();
  }, []);

  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const passOk = /^\d{4}$/.test(password);
  const confirmOk = password === confirm;
  const canSubmit = passOk && confirmOk && !isLoading;

  const handleReset = async () => {
    if (!canSubmit) return;
    try {
      await resetPassword(phone, code, password);
    } catch {
      // error shown via store
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
        <Text style={styles.title}>Nouveau mot de passe</Text>
        <Text style={styles.sub}>Choisissez un nouveau mot de passe pour votre compte</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Nouveau code PIN</Text>
          <TextInput
            style={styles.inputWrap}
            placeholder="4 chiffres"
            placeholderTextColor={TEXT2}
            keyboardType="number-pad"
            value={password}
            onChangeText={(t) => setPassword(t.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            returnKeyType="next"
            editable={!isLoading}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirmer le code</Text>
          <TextInput
            style={[styles.inputWrap, confirm && !confirmOk && styles.inputWrapError]}
            placeholder="Répétez le code"
            placeholderTextColor={TEXT2}
            keyboardType="number-pad"
            value={confirm}
            onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            returnKeyType="done"
            onSubmitEditing={handleReset}
            editable={!isLoading}
          />
          {confirm && !confirmOk && (
            <Text style={styles.fieldError}>Les mots de passe ne correspondent pas</Text>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, !canSubmit && styles.btnOff]}
          onPress={handleReset}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Enregistrer le mot de passe</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 24 },
  back: { position: 'absolute', top: 56, left: 24, padding: 8 },
  backText: { fontSize: 22, color: TEXT },
  form: { gap: 16 },
  title: { fontSize: 22, fontWeight: '800', color: TEXT, textAlign: 'center' },
  sub: { fontSize: 13, color: TEXT2, textAlign: 'center', lineHeight: 20 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: TEXT2 },
  inputWrap: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    backgroundColor: '#FAFAFA', paddingVertical: 13, paddingHorizontal: 14,
    color: TEXT, fontSize: 15,
  },
  inputWrapError: { borderColor: BRAND },
  fieldError: { color: BRAND, fontSize: 12 },
  error: { color: BRAND, fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
