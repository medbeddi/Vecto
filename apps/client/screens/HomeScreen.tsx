import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
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

type Point = { label: string; lat: number; lng: number } | null;

const BRAND = '#25D366';
const BG = '#0a0a0a';

export default function HomeScreen({ navigation }: Props) {
  const [region, setRegion] = useState({
    latitude: 18.0735, longitude: -15.9582,
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [departure, setDeparture] = useState<Point>(null);
  const [destination, setDestination] = useState<Point>(null);
  const [activeField, setActiveField] = useState<'departure' | 'destination'>('destination');
  const [departureText, setDepartureText] = useState('');
  const [destinationText, setDestinationText] = useState('');

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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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
        Alert.alert('Erreur', 'Impossible d\'envoyer la commande. Vérifiez votre connexion.');
      }
    } finally {
      setSending(false);
    }
  }, [startPolling, connectToSocket]);

  // Tap sur la carte → place un marqueur pour le champ actif
  const handleMapPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    if (activeField === 'departure') {
      setDeparture({ label, lat: latitude, lng: longitude });
      setDepartureText(label);
    } else {
      setDestination({ label, lat: latitude, lng: longitude });
      setDestinationText(label);
    }
  }, [activeField]);

  // Bouton "Ma position" → remplit le départ avec GPS
  const locateMe = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setDeparture({ label: 'Ma position', ...coords });
      setDepartureText('Ma position');
      setActiveField('destination');
      mapRef.current?.animateToRegion({
        latitude: coords.lat, longitude: coords.lng,
        latitudeDelta: 0.02, longitudeDelta: 0.02,
      }, 400);
    } catch { Alert.alert('Erreur', 'Impossible d\'obtenir la position.'); }
  }, []);

  // Commande avec les deux points
  const sendRoute = useCallback(async () => {
    if (!destination) return;
    if (departure) {
      await submitOrder('location', null, {
        from: { label: departure.label, lat: departure.lat, lng: departure.lng },
        to: { label: destination.label, lat: destination.lat, lng: destination.lng },
        label: `${departure.label} → ${destination.label}`,
      });
    } else {
      await submitOrder('text', destination.label);
    }
  }, [departure, destination, submitOrder]);

  // Enregistrement vocal
  const toggleRecording = useCallback(async () => {
    if (recording) {
      if (recTimer.current) clearInterval(recTimer.current);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null); setRecSeconds(0);
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
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec); setRecSeconds(0);
    recTimer.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
  }, [recording, submitOrder]);

  const cancelWaiting = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setWaiting(false); setDeliveryId(null);
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const canSend = !!destination && !sending && !waiting;

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
        onPress={!waiting ? handleMapPress : undefined}
        onRegionChangeComplete={setRegion}
      >
        {departure && (
          <Marker
            coordinate={{ latitude: departure.lat, longitude: departure.lng }}
            title="Départ"
            pinColor="#2196F3"
          />
        )}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            title="Destination"
            pinColor="#f44336"
          />
        )}
      </MapView>

      {/* Carte de recherche flottante */}
      {!waiting && (
        <View style={s.searchCard}>
          <Text style={s.searchLabel}>🛵 Vecto — Commander une course</Text>

          {/* Champ départ */}
          <TouchableOpacity
            style={[s.inputRow, activeField === 'departure' && s.inputRowActive]}
            onPress={() => setActiveField('departure')}
            activeOpacity={1}
          >
            <View style={[s.dot, { backgroundColor: '#2196F3' }]} />
            <TextInput
              style={s.textInput}
              placeholder="Point de départ (optionnel)"
              placeholderTextColor="#555"
              value={departureText}
              onChangeText={(v) => {
                setDepartureText(v);
                setDeparture(v.trim() ? { label: v, lat: 0, lng: 0 } : null);
              }}
              onFocus={() => setActiveField('departure')}
              returnKeyType="next"
              editable={!sending}
            />
            {departure && (
              <TouchableOpacity onPress={() => { setDeparture(null); setDepartureText(''); }}>
                <Text style={s.clearBtn}>✕</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* Champ destination */}
          <TouchableOpacity
            style={[s.inputRow, activeField === 'destination' && s.inputRowActive]}
            onPress={() => setActiveField('destination')}
            activeOpacity={1}
          >
            <View style={[s.dot, { backgroundColor: '#f44336' }]} />
            <TextInput
              style={s.textInput}
              placeholder="Destination *"
              placeholderTextColor="#555"
              value={destinationText}
              onChangeText={(v) => {
                setDestinationText(v);
                setDestination(v.trim() ? { label: v, lat: 0, lng: 0 } : null);
              }}
              onFocus={() => setActiveField('destination')}
              returnKeyType="done"
              onSubmitEditing={canSend ? sendRoute : undefined}
              editable={!sending}
            />
            {destination && (
              <TouchableOpacity onPress={() => { setDestination(null); setDestinationText(''); }}>
                <Text style={s.clearBtn}>✕</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <Text style={s.tapHint}>
            {activeField === 'departure' ? '👆 Appuyez sur la carte pour le départ' : '👆 Appuyez sur la carte pour la destination'}
          </Text>

          {/* Bouton commander */}
          {canSend && (
            <TouchableOpacity style={s.commandBtn} onPress={sendRoute} activeOpacity={0.85}>
              <Text style={s.commandBtnText}>Commander →</Text>
            </TouchableOpacity>
          )}
          {sending && (
            <View style={s.commandBtn}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </View>
      )}

      {/* En attente de livreur */}
      {waiting && (
        <View style={s.waitingCard}>
          <Text style={s.waitingTitle}>Recherche d'un livreur...</Text>

          {/* Barre de progression commande */}
          <View style={s.stepsRow}>
            {(['Envoyée', 'Recherche', 'Assignée', 'En route'] as const).map((label, i) => {
              const done = i === 0;
              const current = i === 1;
              return (
                <View key={i} style={s.stepWrap}>
                  {i > 0 && <View style={[s.stepLine, done && s.stepLineDone]} />}
                  <View style={s.stepItem}>
                    <View style={[s.stepDot, done ? s.stepDotDone : current ? s.stepDotCurrent : s.stepDotPending]} />
                    <Text style={[s.stepLabel, done ? s.stepLabelDone : current ? s.stepLabelCurrent : s.stepLabelPending]}>
                      {label}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={s.waitingHint}>Un livreur va accepter votre course dans quelques instants.</Text>
          <TouchableOpacity style={s.cancelBtn} onPress={cancelWaiting}>
            <Text style={s.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Boutons bas */}
      {!waiting && (
        <View style={s.bottomBar}>
          {/* Locate me */}
          <TouchableOpacity style={s.locBtn} onPress={locateMe} disabled={sending}>
            <Text style={s.btnIcon}>📍</Text>
          </TouchableOpacity>

          {/* Micro vocal */}
          {recording ? (
            <>
              <View style={s.recInfo}>
                <View style={s.recDot} />
                <Text style={s.recText}>{fmt(recSeconds)}</Text>
              </View>
              <TouchableOpacity style={[s.micBtn, s.micBtnRec]} onPress={toggleRecording}>
                <Text style={s.btnIcon}>⏹</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[s.micBtn, sending && s.micBtnOff]}
              onPress={toggleRecording}
              disabled={sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnIcon}>🎙</Text>}
            </TouchableOpacity>
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
    position: 'absolute', top: 48, left: 14, right: 14,
    backgroundColor: 'rgba(15,15,15,0.97)',
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: '#2a2a2a',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 10,
    gap: 8,
  },
  searchLabel: { color: BRAND, fontSize: 13, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#2a2a2a',
  },
  inputRowActive: { borderColor: BRAND },
  dot: { width: 10, height: 10, borderRadius: 5 },
  textInput: { flex: 1, color: '#fff', fontSize: 14 },
  clearBtn: { color: '#555', fontSize: 16, paddingLeft: 4 },
  tapHint: { color: '#444', fontSize: 11, textAlign: 'center' },
  commandBtn: {
    backgroundColor: BRAND, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  commandBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
  stepsRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 4 },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepLine: { flex: 1, height: 2, backgroundColor: '#2a2a2a' },
  stepLineDone: { backgroundColor: BRAND },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 12, height: 12, borderRadius: 6 },
  stepDotDone: { backgroundColor: BRAND },
  stepDotCurrent: { backgroundColor: '#fff', borderWidth: 2, borderColor: BRAND },
  stepDotPending: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#444' },
  stepLabel: { fontSize: 9, marginTop: 4, textAlign: 'center', width: 52 },
  stepLabelDone: { color: BRAND, fontWeight: '600' },
  stepLabelCurrent: { color: '#fff', fontWeight: '700' },
  stepLabelPending: { color: '#444' },
  bottomBar: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  locBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(20,20,20,0.92)',
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
  micBtnOff: { opacity: 0.5 },
  btnIcon: { fontSize: 28 },
  recInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(20,20,20,0.92)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f44336' },
  recText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
