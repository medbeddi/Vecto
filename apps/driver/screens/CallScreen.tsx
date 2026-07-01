import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVoiceStore } from '../store/voice.store';
import { Icon } from '../components/Icon';
import { BRAND, TEXT2 } from '../lib/config';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

const PHASE_LABEL: Record<string, string> = {
  idle: 'En attente…',
  connecting: 'Appel en cours…',
  ringing: 'Ça sonne…',
  connected: 'En communication',
  disconnected: 'Appel terminé',
};

export default function CallScreen({ route, navigation }: Props) {
  const { label } = route.params;
  const { phase, muted, hangUp, toggleMute } = useVoiceStore();

  useEffect(() => {
    if (phase === 'disconnected') {
      const t = setTimeout(() => navigation.goBack(), 800);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const onHangUp = async () => {
    await hangUp();
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.center}>
        <View style={styles.avatar}>
          <Icon name="person" size={48} color="#fff" strokeWidth={1.5} />
        </View>
        <Text style={styles.name}>{label}</Text>
        <View style={styles.statusRow}>
          {(phase === 'connecting' || phase === 'ringing') && (
            <ActivityIndicator size="small" color={TEXT2} style={{ marginRight: 8 }} />
          )}
          <Text style={styles.status}>{PHASE_LABEL[phase] ?? phase}</Text>
        </View>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]}
          onPress={toggleMute}
          disabled={phase !== 'connected'}
        >
          <Icon name="mic" size={24} color={muted ? '#fff' : '#1A1A1A'} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.hangupBtn} onPress={onHangUp}>
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
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  status: { color: '#AAAAAA', fontSize: 15 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 32 },
  ctrlBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  ctrlBtnActive: { backgroundColor: BRAND },
  hangupBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '135deg' }] },
});
