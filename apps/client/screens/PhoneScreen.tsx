import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

export default function PhoneScreen() {
  const [phone, setPhone] = useState('');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const isValid = phone.trim().length >= 8;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={s.brand}>
        <Text style={s.logo}>Vecto</Text>
        <Text style={s.sub}>Commandez une livraison</Text>
      </View>
      <View style={s.form}>
        <Text style={s.label}>Votre numéro WhatsApp</Text>
        <TextInput
          style={s.input}
          placeholder="+222 XX XX XX XX"
          placeholderTextColor="#555"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          returnKeyType="done"
          onSubmitEditing={() => isValid && navigation.navigate('Chat', { phone: phone.trim() })}
        />
        <TouchableOpacity
          style={[s.btn, !isValid && s.btnOff]}
          disabled={!isValid}
          onPress={() => navigation.navigate('Chat', { phone: phone.trim() })}
          activeOpacity={0.8}
        >
          <Text style={s.btnText}>Continuer</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const BRAND = '#E85D04';
const BG = '#111111';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 28 },
  brand: { alignItems: 'center', marginBottom: 52 },
  logo: { fontSize: 52, fontWeight: '800', color: BRAND },
  sub: { color: '#888', fontSize: 16, marginTop: 6 },
  form: { gap: 14 },
  label: { color: '#aaa', fontSize: 14, marginBottom: -4 },
  input: {
    backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16,
    color: '#fff', fontSize: 17, borderWidth: 1, borderColor: '#2a2a2a',
  },
  btn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 6,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
