import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { BRAND, SURFACE } from '../lib/config';
import type { Message } from '../types';

type Props = { message: Message };

export function MessageBubble({ message }: Props) {
  const isDriver = message.senderRole === 'driver';

  return (
    <View style={[styles.row, isDriver ? styles.rowRight : styles.rowLeft]}>
      <View
        style={[styles.bubble, isDriver ? styles.bubbleDriver : styles.bubbleClient]}
      >
        <BubbleContent message={message} />
        <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function BubbleContent({ message }: Props) {
  switch (message.type) {
    case 'text':
      return <Text style={styles.text}>{message.content}</Text>;
    case 'image':
      return <ImageContent url={message.content} />;
    case 'audio':
      return <AudioContent url={message.content} />;
    case 'location':
      return <LocationContent meta={message.meta} />;
    default:
      return <Text style={styles.text}>[message non supporté]</Text>;
  }
}

function ImageContent({ url }: { url: string | null }) {
  if (!url) return <Text style={styles.text}>[image indisponible]</Text>;
  return (
    <Image
      source={{ uri: url }}
      style={styles.image}
      resizeMode="cover"
    />
  );
}

function AudioContent({ url }: { url: string | null }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const toggle = async () => {
    if (!url) return;
    if (playing) {
      await soundRef.current?.pauseAsync();
      setPlaying(false);
      return;
    }
    setLoading(true);
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: url });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) setPlaying(false);
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity onPress={toggle} style={styles.audioRow}>
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.audioIcon}>{playing ? '⏸' : '▶'}</Text>
      )}
      <Text style={styles.audioLabel}>{playing ? 'En cours...' : 'Audio'}</Text>
    </TouchableOpacity>
  );
}

function LocationContent({ meta }: { meta: Message['meta'] }) {
  const open = () => {
    if (!meta?.lat || !meta?.lng) return;
    Linking.openURL(
      `https://maps.google.com/?q=${meta.lat},${meta.lng}`
    );
  };
  return (
    <TouchableOpacity onPress={open} style={styles.locationRow}>
      <Text style={styles.locationIcon}>📍</Text>
      <View>
        <Text style={styles.locationLabel}>{meta?.label ?? 'Position partagée'}</Text>
        {meta?.lat != null && (
          <Text style={styles.locationCoords}>
            {meta.lat.toFixed(5)}, {meta.lng?.toFixed(5)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, paddingHorizontal: 12 },
  rowLeft: { alignItems: 'flex-start' },
  rowRight: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    padding: 10,
  },
  bubbleClient: {
    backgroundColor: SURFACE,
    borderBottomLeftRadius: 4,
  },
  bubbleDriver: {
    backgroundColor: BRAND,
    borderBottomRightRadius: 4,
  },
  text: { color: '#fff', fontSize: 15, lineHeight: 21 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  image: { width: 200, height: 150, borderRadius: 8 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  audioIcon: { fontSize: 20, color: '#fff' },
  audioLabel: { color: '#fff', fontSize: 14 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationIcon: { fontSize: 22 },
  locationLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  locationCoords: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
});
