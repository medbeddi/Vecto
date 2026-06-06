import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';
import { Icon } from '../components/Icon';
import { PRIMARY, BG, TEXT, TEXT2, BORDER, BRAND } from '../lib/config';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export default function SetupScreen({ route, navigation }: Props) {
  const { phone, code } = route.params;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [securePass, setSecurePass] = useState(true);
  const [secureConf, setSecureConf] = useState(true);

  const { verifyOtp, isLoading, error, clearError } = useAuthStore();

  const nameOk = name.trim().length >= 2;
  const passOk = password.length >= 6;
  const confirmOk = password === confirm;
  const canSubmit = nameOk && passOk && confirmOk && !isLoading;

  const handleCreate = async () => {
    if (!canSubmit) return;
    try {
      await verifyOtp(phone, code, name.trim(), password);
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

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.title}>Créer votre compte</Text>
          <Text style={styles.sub}>Renseignez votre nom et choisissez un mot de passe</Text>

          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Nom complet</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex. Karim Ben Ali"
              placeholderTextColor={TEXT2}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
              editable={!isLoading}
              autoFocus
            />
          </View>

          {/* Password */}
          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.inputFlex}
                placeholder="6 caractères minimum"
                placeholderTextColor={TEXT2}
                secureTextEntry={securePass}
                value={password}
                onChangeText={setPassword}
                returnKeyType="next"
                editable={!isLoading}
              />
              <TouchableOpacity onPress={() => setSecurePass((s) => !s)} style={styles.eyeBtn}>
                <Icon name={securePass ? 'eye' : 'eye-off'} size={20} color={TEXT2} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm */}
          <View style={styles.field}>
            <Text style={styles.label}>Confirmer le mot de passe</Text>
            <View style={[styles.inputWrap, confirm && !confirmOk && styles.inputWrapError]}>
              <TextInput
                style={styles.inputFlex}
                placeholder="Répétez le mot de passe"
                placeholderTextColor={TEXT2}
                secureTextEntry={secureConf}
                value={confirm}
                onChangeText={setConfirm}
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                editable={!isLoading}
              />
              <TouchableOpacity onPress={() => setSecureConf((s) => !s)} style={styles.eyeBtn}>
                <Icon name={secureConf ? 'eye' : 'eye-off'} size={20} color={TEXT2} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {confirm && !confirmOk && (
              <Text style={styles.fieldError}>Les mots de passe ne correspondent pas</Text>
            )}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, !canSubmit && styles.btnOff]}
            onPress={handleCreate}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            {isLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Créer mon compte</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 80 },
  back: { position: 'absolute', top: 56, left: 24, padding: 8, zIndex: 10 },
  backText: { fontSize: 22, color: TEXT },
  form: { gap: 16 },
  title: { fontSize: 22, fontWeight: '800', color: TEXT, textAlign: 'center' },
  sub: { fontSize: 13, color: TEXT2, textAlign: 'center', lineHeight: 20 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: TEXT2 },
  input: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    backgroundColor: '#FAFAFA', paddingVertical: 13, paddingHorizontal: 14,
    color: TEXT, fontSize: 15,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    backgroundColor: '#FAFAFA', overflow: 'hidden',
  },
  inputWrapError: { borderColor: BRAND },
  inputFlex: { flex: 1, paddingVertical: 13, paddingHorizontal: 14, color: TEXT, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 12 },
  fieldError: { color: BRAND, fontSize: 12 },
  error: { color: BRAND, fontSize: 13, textAlign: 'center' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
