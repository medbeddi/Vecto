import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createDelivery, getActiveDelivery, uploadFile } from '../lib/api';
import { connectClientSocket } from '../lib/socket';
import { getClientToken } from '../lib/api';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const BRAND = '#25D366';
const BG = '#0a0a0a';

export default function HomeScreen({ navigation }: Props) {
  const [region, setRegion] = useState({
    latitude: 18.0735, longitude: -15.9582, // Nouakchott
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [destination, setDestination] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<MapView>(null);

  // Localisation utilisateur
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coords);
      setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    })();
  }, []);

  // Reprendre une delivery active si elle existe
  useEffect(() => {
    (async () => {
      try {
        const { delivery } = await getActiveDelivery();
        if (delivery) {
          if (delivery.status === 'assigned' || delivery.status === 'in_progress') {
            navigation.replace('Chat', { deliveryId: delivery.id });
          } else if (delivery.status === 'pending') {
            setDeliveryId(delivery.id);
            setWaiting(true);
            startPolling(delivery.id);
            connectToSocket(delivery.id);
          }
        }
      } catch {}
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const connectToSocket = useCallback((dId: string) => {
    const token = getClientToken();
    if (!token) return;
    const socket = connectClientSocket(token);
    socket.emit('join_delivery', { deliveryId: dId });
    socket.on('order_assigned', () => {
      setWaiting(false);
      if (pollRef.current) clearInterval(pollRef.current);
      navigation.replace('Chat', { deliveryId: dId });
    });
  }, [navigation]);

  const startPolling = useCallback((dId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { delivery } = await getActiveDelivery();
        if (delivery && (delivery.status === 'assigned' || delivery.status === 'in_progress')) {
          clearInterval(pollRef.current!);
          setWaiting(false);
          navigation.replace('Chat', { deliveryId: dId });
        }
      } catch {}
    }, 3000);
  }, [navigation]);

  const submitOrder = useCallback(async (type: string, content?: string | null, meta?: any) => {
    setSending(true);
    try {
      const { delivery } = await createDelivery({ type, content, meta });
      setDeliveryId(delivery.id);
      setWaiting(true);
      startPolling(delivery.id);
      connectToSocket(delivery.id);
    } catch (err: any) {
      if (err.code === 'DELIVERY_ALREADY_ACTIVE') {
        Alert.alert('Course en cours', 'Vous avez déjà une course en attente.');
      } else {
        Alert.alert('Erreur', 'Impossible d\'envoyer la commande.');
      }
    } finally {
      setSending(false);
    }
  }, [startPolling, connectToSocket]);

  const sendText = useCallback(async () => {
    const t = destination.trim();
    if (!t) return;
    setDestination('');
    await submitOrder('text', t);
  }, [destination, submitOrder]);

  const sendLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    setSending(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await submitOrder('location', null, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        label: 'Ma position',
      });
    } catch { setSending(false); }
  }, [submitOrder]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      if (recTimer.current) clearInterval(recTimer.current);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setRecSeconds(0);
      if (!uri) return;
      setSending(true);
      try {
        const { url } = await uploadFile(uri, 'audio/m4a', 'm4a');
        await submitOrder('audio', url);
      } catch {
        Alert.alert('Erreur', 'Upload du message vocal échoué.');
        setSending(false);
      }
      return;
    }
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    setRecording(rec);
    setRecSeconds(0);
    recTimer.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
  }, [recording, submitOrder]);

  const cancelWaiting = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setWaiting(false);
    setDeliveryId(null);
  }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Carte */}
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_DEFAULT}
        region={region}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {userLocation && (
          <Marker coordinate={userLocation} title="Vous" />
        )}
      </MapView>

      {/* Barre de recherche flottante */}
      {!waiting && (
        <View style={s.searchCard}>
          <Text style={s.searchLabel}>🛵 Vecto — Où livrer ?</Text>
          <View style={s.searchRow}>
            <TextInput
              style={s.searchInput}
              placeholder="Adresse ou description..."
              placeholderTextColor="#555"
              value={destination}
              onChangeText={setDestination}
              returnKeyType="send"
              onSubmitEditing={sendText}
              editable={!sending}
            />
            {destination.trim() ? (
              <TouchableOpacity style={s.sendBtn} onPress={sendText} disabled={sending}>
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.sendIcon}>➤</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}

      {/* En attente de livreur */}
      {waiting && (
        <View style={s.waitingCard}>
          <ActivityIndicator color={BRAND} size="large" />
          <Text style={s.waitingTitle}>Recherche d'un livreur...</Text>
          <Text style={s.waitingHint}>Un livreur va accepter votre course dans quelques instants.</Text>
          <TouchableOpacity style={s.cancelBtn} onPress={cancelWaiting}>
            <Text style={s.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Boutons flottants bas */}
      {!waiting && (
        <View style={s.bottomBar}>
          <TouchableOpacity style={s.locBtn} onPress={sendLocation} disabled={sending}>
            <Text style={s.btnIcon}>📍</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.micBtn, recording && s.micBtnRec]}
            onPress={toggleRecording}
            disabled={sending && !recording}
          >
            {sending && !recording
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnIcon}>{recording ? '⏹' : '🎙'}</Text>}
          </TouchableOpacity>

          {recording && (
            <View style={s.recInfo}>
              <View style={s.recDot} />
              <Text style={s.recText}>{fmt(recSeconds)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  map: { ...StyleSheet.absoluteFillObject },
  searchCard: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: 'rgba(20,20,20,0.97)',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#2a2a2a',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  searchLabel: { color: BRAND, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInput: {
    flex: 1, backgroundColor: '#111', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15,
    borderWidth: 1, borderColor: '#333',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: '#fff', fontSize: 16 },
  waitingCard: {
    position: 'absolute', bottom: 120, left: 24, right: 24,
    backgroundColor: 'rgba(15,15,15,0.97)', borderRadius: 20,
    padding: 28, alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#25D36644',
  },
  waitingTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  waitingHint: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  cancelBtn: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 20 },
  cancelText: { color: '#f44336', fontSize: 14 },
  bottomBar: {
    position: 'absolute', bottom: 48, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  locBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(20,20,20,0.9)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#333',
  },
  micBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  micBtnRec: { backgroundColor: '#f44336' },
  btnIcon: { fontSize: 28 },
  recInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(20,20,20,0.9)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f44336' },
  recText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
