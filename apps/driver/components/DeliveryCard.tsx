import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Audio } from 'expo-av';
import { PRIMARY, CARD, BORDER, TEXT, TEXT2 } from '../lib/config';
import { Icon } from './Icon';
import type { Delivery } from '../types';

type Props = {
  delivery: Delivery;
  onAccept: (delivery: Delivery) => void;
  onRefuse?: (delivery: Delivery) => void;
  accepting: boolean;
};

const WAVE_COUNT = 20;

function genWave(n: number) {
  return Array.from({ length: n }, () => Math.random() * 0.65 + 0.2);
}

export function DeliveryCard({ delivery, onAccept, onRefuse, accepting }: Props) {
  const age = formatAge(delivery.createdAt);
  const initial = (delivery.clientAlias ?? '?')[0].toUpperCase();
  const hasAudio = delivery.initialMediaType === 'audio' && !!delivery.initialMediaUrl;

  const wave = useMemo(() => genWave(WAVE_COUNT), [delivery.id]);
  const animVals = useRef(wave.map(() => new Animated.Value(1))).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
      loopRef.current?.stop();
    };
  }, []);

  const startWaveAnim = () => {
    const anims = animVals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 35),
          Animated.timing(v, { toValue: 0.3 + Math.random() * 0.7, duration: 200, useNativeDriver: false }),
          Animated.timing(v, { toValue: wave[i], duration: 200, useNativeDriver: false }),
        ])
      )
    );
    loopRef.current = Animated.parallel(anims);
    loopRef.current.start();
  };

  const stopWaveAnim = () => {
    loopRef.current?.stop();
    animVals.forEach((v, i) => v.setValue(wave[i]));
  };

  const toggleAudio = async () => {
    if (!hasAudio) return;
    if (playing) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setPlaying(false);
      stopWaveAnim();
      return;
    }
    setLoadingAudio(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync(
        { uri: delivery.initialMediaUrl! },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlaying(true);
      startWaveAnim();
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setPlaying(false);
          stopWaveAnim();
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch {
      setPlaying(false);
    } finally {
      setLoadingAudio(false);
    }
  };

  return (
    <View style={styles.card}>
      {/* Header: avatar + nom + temps */}
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View>
          <Text style={styles.clientName}>{delivery.clientAlias}</Text>
          <Text style={styles.clientTime}>{age}</Text>
        </View>
      </View>

      {/* Prix si défini */}
      {delivery.price != null && (
        <View style={styles.priceBadge}>
          <Text style={styles.priceText}>{delivery.price} MRU</Text>
        </View>
      )}

      {/* Itinéraire si défini */}
      {(delivery.pickupAddress || delivery.dropoffAddress) ? (
        <View style={styles.routeBox}>
          {delivery.pickupAddress ? (
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#34C759' }]} />
              <Text style={styles.routeText} numberOfLines={1}>{delivery.pickupAddress}</Text>
            </View>
          ) : null}
          {delivery.dropoffAddress ? (
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#FF3B30' }]} />
              <Text style={styles.routeText} numberOfLines={1}>{delivery.dropoffAddress}</Text>
            </View>
          ) : null}
        </View>
      ) : delivery.description && delivery.initialMediaType !== 'audio' ? (
        <Text style={styles.desc} numberOfLines={2}>{delivery.description}</Text>
      ) : null}

      {/* Lecteur audio — uniquement s'il y a vraiment un fichier audio */}
      {hasAudio && (
        <View style={styles.waveRow}>
          <TouchableOpacity
            style={styles.playBtn}
            onPress={toggleAudio}
            disabled={loadingAudio}
            activeOpacity={0.75}
          >
            {loadingAudio
              ? <ActivityIndicator size="small" color="#fff" />
              : playing
                ? <Icon name="pause" size={16} color="#fff" strokeWidth={2} />
                : <Icon name="play" size={16} color="#fff" />
            }
          </TouchableOpacity>

          <View style={styles.waveform}>
            {animVals.map((v, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.waveBar,
                  { height: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                  playing && styles.waveBarActive,
                ]}
              />
            ))}
          </View>

          <Text style={styles.waveDur}>vocal</Text>
        </View>
      )}

      {/* Boutons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btnRefuse}
          onPress={() => onRefuse?.(delivery)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnRefuseText}>Refuser</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnAccept, accepting && styles.btnOff]}
          onPress={() => onAccept(delivery)}
          disabled={accepting}
          activeOpacity={0.75}
        >
          {accepting
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Icon name="check" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.btnAcceptText}>Accepter</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatAge(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `Il y a ${m} min`;
  return `Il y a ${Math.floor(m / 60)} h`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    gap: 14,
  },
  // Header
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#C7E0F4',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#1565C0' },
  clientName: { fontSize: 15, fontWeight: '700', color: TEXT },
  clientTime: { fontSize: 12, color: TEXT2, marginTop: 1 },
  // Waveform
  waveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F5F7', borderRadius: 12, padding: 12,
    borderWidth: 0.5, borderColor: BORDER,
  },
  playBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  playIcon: { color: '#fff', fontSize: 14, marginLeft: 2 },
  waveform: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: 2, height: 32,
  },
  waveBar: {
    flex: 1, borderRadius: 2, backgroundColor: '#AEAEB2',
  },
  waveBarActive: { backgroundColor: PRIMARY },
  waveDur: { fontSize: 12, fontWeight: '600', color: TEXT2, flexShrink: 0 },
  desc: { fontSize: 14, color: TEXT2, lineHeight: 20 },
  priceBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start',
  },
  priceText: { color: '#1a7a35', fontSize: 18, fontWeight: '800' },
  routeBox: {
    backgroundColor: '#F5F5F7', borderRadius: 10, padding: 10, gap: 8,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  routeText: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '500' },
  // Boutons
  actions: { flexDirection: 'row', gap: 10 },
  btnRefuse: {
    flex: 1,
    paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#F5F5F7',
    borderWidth: 0.5, borderColor: BORDER,
    alignItems: 'center',
  },
  btnRefuseText: { fontSize: 15, fontWeight: '600', color: TEXT2 },
  btnAccept: {
    flex: 2,
    paddingVertical: 13, borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  btnAcceptText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnOff: { opacity: 0.5 },
});
