import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { PRIMARY, TEXT, TEXT2, BUBBLE_DRIVER, BUBBLE_CLIENT } from '../lib/config';
import { api } from '../lib/api';
import type { Message } from '../types';

type Props = { message: Message; onLongPress?: () => void; onPressImage?: (url: string) => void };

export function MessageBubble({ message, onLongPress, onPressImage }: Props) {
  const isDriver = message.senderRole === 'driver';
  const isAdmin = message.senderRole === 'admin';
  const reactions = message.meta?.reactions ?? {};
  const reactionEntries = Object.entries(reactions);

  // Message vocal de lancement (admin) → bulle système centrée
  if (isAdmin) {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemLabel}>🎙 Message vocal de lancement</Text>
        <View style={styles.systemBubble}>
          <BubbleContent message={message} isDriver={false} onPressImage={onPressImage} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isDriver ? styles.rowRight : styles.rowLeft]}>
      <TouchableOpacity
        onLongPress={onLongPress}
        activeOpacity={0.85}
        delayLongPress={350}
      >
        <View style={[styles.bubble, isDriver ? styles.bubbleDriver : styles.bubbleClient]}>
          <BubbleContent message={message} isDriver={isDriver} onPressImage={onPressImage} />
          <Text style={[styles.time, isDriver ? styles.timeDriver : styles.timeClient]}>
            {formatTime(message.createdAt)}
          </Text>
        </View>
        {reactionEntries.length > 0 && (
          <View style={[styles.reactionsRow, isDriver ? styles.reactionsRight : styles.reactionsLeft]}>
            {reactionEntries.map(([emoji, users]) => (
              <View key={emoji} style={styles.reactionChip}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {users.length > 1 && <Text style={styles.reactionCount}>{users.length}</Text>}
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function BubbleContent({ message, isDriver, onPressImage }: Props & { isDriver: boolean }) {
  switch (message.type) {
    case 'text':
      return <Text style={[styles.text, isDriver ? styles.textDriver : styles.textClient]}>{message.content}</Text>;
    case 'image':
      return <ImageContent url={message.content} uploadFailed={!!message.meta?.uploadFailed} onPress={onPressImage} />;
    case 'audio':
      return <AudioContent url={message.meta?.r2Key ?? message.content} isDriver={isDriver} uploadFailed={!!message.meta?.uploadFailed} />;
    case 'location':
      return <LocationContent meta={message.meta} isDriver={isDriver} />;
    default:
      return <Text style={[styles.text, isDriver ? styles.textDriver : styles.textClient]}>[message non supporté]</Text>;
  }
}

function ImageContent({ url, uploadFailed, onPress }: { url: string | null; uploadFailed?: boolean; onPress?: (url: string) => void }) {
  if (!url) return <Text style={styles.textClient}>{uploadFailed ? '⚠ Image non reçue (erreur upload)' : '[image indisponible]'}</Text>;
  return (
    <TouchableOpacity onPress={() => onPress?.(url)} activeOpacity={0.85} disabled={!onPress}>
      <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
    </TouchableOpacity>
  );
}

async function resolveAudioUrl(urlOrKey: string | null): Promise<string | null> {
  if (!urlOrKey) return null;
  if (urlOrKey.startsWith('http')) return urlOrKey;
  try {
    const { url } = await api<{ url: string }>(`/api/media/url?key=${encodeURIComponent(urlOrKey)}`);
    return url;
  } catch {
    return null;
  }
}

function AudioContent({ url, isDriver, uploadFailed }: { url: string | null; isDriver: boolean; uploadFailed?: boolean }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync(); };
  }, []);

  if (!url) {
    const msg = uploadFailed ? '⚠ Audio non reçu (erreur upload)' : '⚠ Audio indisponible';
    return <Text style={[styles.text, isDriver ? styles.textDriver : styles.textClient]}>{msg}</Text>;
  }

  const toggle = async () => {
    if (playing) {
      await soundRef.current?.pauseAsync();
      setPlaying(false);
      return;
    }
    setLoading(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      if (!soundRef.current) {
        const resolvedUrl = await resolveAudioUrl(url);
        if (!resolvedUrl) {
          Alert.alert('Erreur', 'Impossible de charger cet audio.');
          return;
        }
        const { sound, status } = await Audio.Sound.createAsync({ uri: resolvedUrl });
        soundRef.current = sound;
        if (status.isLoaded && status.durationMillis) setDuration(status.durationMillis);
        sound.setOnPlaybackStatusUpdate((s) => {
          if (s.isLoaded && s.didJustFinish) {
            setPlaying(false);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
          }
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    } catch {
      Alert.alert('Erreur', 'Impossible de lire ce message audio.');
      soundRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const fmtDur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <TouchableOpacity onPress={toggle} style={styles.audioRow}>
      <View style={[styles.audioPlayBtn, isDriver ? styles.audioPlayBtnDriver : styles.audioPlayBtnClient]}>
        {loading
          ? <ActivityIndicator size="small" color={isDriver ? '#fff' : TEXT} />
          : <Text style={[styles.audioPlayIcon, isDriver && { color: '#fff' }]}>
              {playing ? '⏸' : '▶'}
            </Text>
        }
      </View>
      <View style={styles.audioWave}>
        {[3, 6, 9, 7, 5, 8, 4, 7, 6, 4, 5, 8, 6, 3].map((h, i) => (
          <View
            key={i}
            style={[
              styles.audioBar,
              { height: playing ? h * 3 : h * 2 },
              isDriver ? styles.audioBarDriver : styles.audioBarClient,
            ]}
          />
        ))}
      </View>
      <Text style={[styles.audioDur, isDriver ? styles.audioDurDriver : styles.audioDurClient]}>
        {playing ? 'En cours' : duration ? fmtDur(duration) : '—:—'}
      </Text>
    </TouchableOpacity>
  );
}

function LocationContent({ meta, isDriver }: { meta: Message['meta']; isDriver: boolean }) {
  const open = () => {
    if (!meta?.lat || !meta?.lng) return;
    Linking.openURL(`https://maps.google.com/?q=${meta.lat},${meta.lng}`);
  };
  return (
    <TouchableOpacity onPress={open} style={styles.locationRow}>
      <Text style={styles.locationIcon}>📍</Text>
      <View>
        <Text style={[styles.locationLabel, isDriver ? styles.textDriver : styles.textClient]}>
          {meta?.label ?? 'Position partagée'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  row: { marginVertical: 3, paddingHorizontal: 12 },
  rowLeft: { alignItems: 'flex-start' },
  rowRight: { alignItems: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 18, padding: 10 },
  bubbleDriver: { backgroundColor: BUBBLE_DRIVER, borderBottomRightRadius: 4 },
  bubbleClient: { backgroundColor: BUBBLE_CLIENT, borderBottomLeftRadius: 4 },
  text: { fontSize: 15, lineHeight: 21 },
  textDriver: { color: '#fff' },
  textClient: { color: TEXT },
  time: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  timeDriver: { color: 'rgba(255,255,255,0.55)' },
  timeClient: { color: TEXT2 },
  image: { width: 200, height: 150, borderRadius: 10 },

  // Audio
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  audioPlayBtn: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  audioPlayBtnDriver: { backgroundColor: 'rgba(255,255,255,0.2)' },
  audioPlayBtnClient: { backgroundColor: 'rgba(0,0,0,0.08)' },
  audioPlayIcon: { fontSize: 14, color: TEXT },
  audioWave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 30 },
  audioBar: { width: 3, borderRadius: 2 },
  audioBarDriver: { backgroundColor: 'rgba(255,255,255,0.7)' },
  audioBarClient: { backgroundColor: 'rgba(0,0,0,0.3)' },
  audioDur: { fontSize: 11 },
  audioDurDriver: { color: 'rgba(255,255,255,0.7)' },
  audioDurClient: { color: TEXT2 },

  // Reactions
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  reactionsLeft: { justifyContent: 'flex-start' },
  reactionsRight: { justifyContent: 'flex-end' },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 10, fontWeight: '700', color: TEXT2 },

  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationIcon: { fontSize: 22 },
  locationLabel: { fontSize: 14, fontWeight: '600' },
  locationCoords: { fontSize: 11, marginTop: 2 },

  // Bulle système (message admin de lancement)
  systemRow: { alignItems: 'center', marginVertical: 10, paddingHorizontal: 20 },
  systemLabel: { fontSize: 11, color: TEXT2, marginBottom: 6, fontStyle: 'italic' },
  systemBubble: {
    backgroundColor: '#FFFBE6',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FFD966',
    maxWidth: '90%',
  },
});
