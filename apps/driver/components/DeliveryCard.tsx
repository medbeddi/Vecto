import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Audio } from 'expo-av';
import { BORDER } from '../lib/config';
import { Icon } from './Icon';
import type { Delivery } from '../types';

const WAVE_COUNT = 20;
const GREEN = '#34C759';
const RED   = '#FF3B30';
const ACCEPT_GREEN = '#22C55E';

type Props = {
  delivery: Delivery;
  onAccept: (delivery: Delivery) => void;
  onRefuse?: (delivery: Delivery) => void;
  accepting: boolean;
};

function genWave(n: number) {
  return Array.from({ length: n }, () => Math.random() * 0.65 + 0.2);
}

function orderTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function splitAddr(addr: string): [string, string | null] {
  const i = addr.indexOf(',');
  return i === -1 ? [addr, null] : [addr.slice(0, i).trim(), addr.slice(i + 1).trim()];
}

export function DeliveryCard({ delivery, onAccept, onRefuse, accepting }: Props) {
  const hasAudio = delivery.initialMediaType === 'audio' && !!delivery.initialMediaUrl;
  const wave     = useMemo(() => genWave(WAVE_COUNT), [delivery.id]);
  const animVals = useRef(wave.map(() => new Animated.Value(1))).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const loopRef  = useRef<Animated.CompositeAnimation | null>(null);

  const [playing,      setPlaying]      = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [durSec,       setDurSec]       = useState<number | null>(null);

  const [pickupMain,  pickupSub]  = delivery.pickupAddress  ? splitAddr(delivery.pickupAddress)  : ['', null];
  const [dropoffMain, dropoffSub] = delivery.dropoffAddress ? splitAddr(delivery.dropoffAddress) : ['', null];

  useEffect(() => () => {
    soundRef.current?.unloadAsync();
    loopRef.current?.stop();
  }, []);

  const startWave = () => {
    const anims = animVals.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 35),
        Animated.timing(v, { toValue: 0.3 + Math.random() * 0.7, duration: 200, useNativeDriver: false }),
        Animated.timing(v, { toValue: wave[i],                    duration: 200, useNativeDriver: false }),
      ]))
    );
    loopRef.current = Animated.parallel(anims);
    loopRef.current.start();
  };

  const stopWave = () => {
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
      stopWave();
      return;
    }
    setLoadingAudio(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: delivery.initialMediaUrl! },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      if (status.isLoaded && status.durationMillis) setDurSec(Math.round(status.durationMillis / 1000));
      setPlaying(true);
      startWave();
      sound.setOnPlaybackStatusUpdate((s) => {
        if (!s.isLoaded) return;
        if (!durSec && s.durationMillis) setDurSec(Math.round(s.durationMillis / 1000));
        if (s.didJustFinish) { setPlaying(false); stopWave(); sound.unloadAsync(); soundRef.current = null; }
      });
    } catch { setPlaying(false); }
    finally  { setLoadingAudio(false); }
  };

  const durStr = durSec != null
    ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}`
    : '0:00';

  const hasRoute = !!(delivery.pickupAddress || delivery.dropoffAddress);
  const hasStats = delivery.distanceKm != null || delivery.durationMin != null;

  return (
    <View style={styles.card}>

      {/* ── Dark header ─────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {/* LEFT: heure de création */}
          <View style={styles.timeBadge}>
            <Icon name="clock" size={13} color="#ccc" strokeWidth={2} />
            <Text style={styles.timeText}>{orderTime(delivery.createdAt)}</Text>
          </View>
          {/* RIGHT: prix */}
          {delivery.price != null && (
            <View style={styles.priceGroup}>
              <Text style={styles.priceAmount}>{delivery.price} MRU</Text>
              <Text style={styles.priceLabel}>Prix de la course</Text>
            </View>
          )}
        </View>
        {/* Barre verte en bas du header */}
        <View style={styles.greenBar} />
      </View>

      {/* ── Body ───────────────────────────────────── */}
      <View style={styles.body}>

        {/* Itinéraire */}
        {hasRoute && (
          <View style={styles.route}>
            {delivery.pickupAddress ? (
              <View style={styles.stop}>
                <View style={styles.stopLeft}>
                  <View style={[styles.stopDot, { backgroundColor: GREEN }]} />
                </View>
                <View style={styles.stopRight}>
                  <Text style={styles.stopLabel}>DÉPART</Text>
                  <Text style={styles.stopMain} numberOfLines={1}>{pickupMain}</Text>
                  {pickupSub ? <Text style={styles.stopSub} numberOfLines={1}>{pickupSub}</Text> : null}
                </View>
              </View>
            ) : null}

            {delivery.pickupAddress && delivery.dropoffAddress ? (
              <View style={styles.connectorCol}>
                {[0,1,2,3,4].map(i => <View key={i} style={styles.connDot} />)}
              </View>
            ) : null}

            {delivery.dropoffAddress ? (
              <View style={styles.stop}>
                <View style={styles.stopLeft}>
                  <View style={[styles.stopDot, { backgroundColor: RED }]} />
                </View>
                <View style={styles.stopRight}>
                  <Text style={styles.stopLabel}>LIVRAISON</Text>
                  <Text style={styles.stopMain} numberOfLines={1}>{dropoffMain}</Text>
                  {dropoffSub ? <Text style={styles.stopSub} numberOfLines={1}>{dropoffSub}</Text> : null}
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Description texte si pas d'adresses */}
        {!hasRoute && delivery.description && delivery.initialMediaType !== 'audio' ? (
          <Text style={styles.desc} numberOfLines={2}>{delivery.description}</Text>
        ) : null}

        {/* Stats chips */}
        {hasStats && (
          <View style={styles.statsRow}>
            {delivery.distanceKm != null && (
              <View style={styles.chip}>
                <Icon name="location" size={13} color="#555" strokeWidth={1.75} />
                <Text style={styles.chipText}>{delivery.distanceKm} km</Text>
              </View>
            )}
            {delivery.durationMin != null && (
              <View style={styles.chip}>
                <Icon name="clock" size={13} color="#555" strokeWidth={1.75} />
                <Text style={styles.chipText}>{delivery.durationMin} min</Text>
              </View>
            )}
          </View>
        )}

        {/* Lecteur vocal */}
        {hasAudio && (
          <View style={styles.audioRow}>
            <View style={styles.audioLeft}>
              <Icon name="mic" size={14} color="#1565C0" strokeWidth={1.75} />
              <Text style={styles.audioLabel}>Message vocal</Text>
            </View>
            <TouchableOpacity
              style={styles.audioPlay}
              onPress={toggleAudio}
              disabled={loadingAudio}
              activeOpacity={0.75}
            >
              {loadingAudio
                ? <ActivityIndicator size="small" color="#fff" />
                : playing
                  ? <Icon name="pause" size={14} color="#fff" strokeWidth={2} />
                  : <Icon name="play" size={14} color="#fff" />}
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
            <Text style={styles.audioDur}>{durStr}</Text>
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
                </>}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },

  // ── Header sombre ──────────────────────────────
  header: { backgroundColor: '#1C1C1E' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  timeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  timeText: { color: '#ccc', fontSize: 13, fontWeight: '600' },
  priceGroup: { alignItems: 'flex-end' },
  priceAmount: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  priceLabel: { color: '#888', fontSize: 11, marginTop: 1 },
  greenBar: { height: 3, backgroundColor: GREEN },

  // ── Body ──────────────────────────────────────
  body: { padding: 16, gap: 14 },

  // Route
  route: { gap: 0 },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stopLeft: { width: 18, alignItems: 'center', paddingTop: 16 },
  stopDot: { width: 11, height: 11, borderRadius: 6 },
  stopRight: { flex: 1, paddingBottom: 6 },
  stopLabel: { fontSize: 10, fontWeight: '700', color: '#999', letterSpacing: 0.6, marginBottom: 2 },
  stopMain: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  stopSub: { fontSize: 13, color: '#888', marginTop: 1 },
  connectorCol: { flexDirection: 'column', alignItems: 'center', marginLeft: 8, gap: 3, paddingVertical: 2 },
  connDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#CCC' },

  desc: { fontSize: 14, color: '#888', lineHeight: 20 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F3F3F3',
    borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#444' },
  chipPrice: { backgroundColor: '#E8F5E9' },
  chipPriceText: { fontSize: 13, fontWeight: '700', color: '#1a7a35' },

  // Audio
  audioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EBF4FF', borderRadius: 12, padding: 12,
  },
  audioLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  audioLabel: { fontSize: 13, fontWeight: '600', color: '#1565C0' },
  audioPlay: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#1976D2',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  waveBar: { flex: 1, borderRadius: 2, backgroundColor: '#93C5FD' },
  waveBarActive: { backgroundColor: '#1976D2' },
  audioDur: { fontSize: 12, fontWeight: '600', color: '#555', flexShrink: 0 },

  // Boutons
  actions: { flexDirection: 'row', gap: 10 },
  btnRefuse: {
    flex: 1, paddingVertical: 14, borderRadius: 13,
    backgroundColor: '#F5F5F7',
    borderWidth: 0.5, borderColor: BORDER,
    alignItems: 'center',
  },
  btnRefuseText: { fontSize: 15, fontWeight: '600', color: '#555' },
  btnAccept: {
    flex: 2, paddingVertical: 14, borderRadius: 13,
    backgroundColor: ACCEPT_GREEN,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  btnAcceptText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnOff: { opacity: 0.5 },
});
