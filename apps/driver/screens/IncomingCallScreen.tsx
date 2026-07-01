import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVoiceStore } from '../store/voice.store';
import { Icon } from '../components/Icon';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingCall'>;

function labelFromIdentity(from: string) {
  const clean = from.replace(/^client:/, '');
  if (clean === 'cc') return 'Centre d\'appels';
  if (clean.startsWith('driver_')) return 'Livreur';
  if (clean.startsWith('client_')) return 'Client';
  return clean;
}

export default function IncomingCallScreen({ navigation }: Props) {
  const { incomingInvite, acceptIncoming, rejectIncoming, phase } = useVoiceStore();

  useEffect(() => {
    if (!incomingInvite) navigation.goBack();
  }, [incomingInvite]);

  useEffect(() => {
    if (phase === 'connected') {
      navigation.replace('Call', { label: incomingInvite ? labelFromIdentity(incomingInvite.getFrom() ?? '') : 'Appel' });
    }
  }, [phase]);

  if (!incomingInvite) return null;
  const label = labelFromIdentity(incomingInvite.getFrom() ?? '');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.center}>
        <View style={styles.avatar}>
          <Icon name="person" size={48} color="#fff" strokeWidth={1.5} />
        </View>
        <Text style={styles.name}>{label}</Text>
        <Text style={styles.status}>Appel entrant…</Text>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity style={styles.rejectBtn} onPress={async () => { await rejectIncoming(); navigation.goBack(); }}>
          <Icon name="phone" size={28} color="#fff" strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptBtn} onPress={acceptIncoming}>
          <Icon name="phone" size={28} color="#fff" strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111111', justifyContent: 'space-between', paddingVertical: 80 },
  center: { alignItems: 'center', marginTop: 60 },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  name: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  status: { color: '#AAAAAA', fontSize: 15 },
  controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 60 },
  rejectBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '135deg' }] },
  acceptBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center' },
});
