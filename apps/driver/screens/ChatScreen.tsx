import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useDeliveriesStore } from '../store/deliveries.store';
import { socketService } from '../lib/socket';
import { api, uploadFile } from '../lib/api';
import { MessageBubble } from '../components/MessageBubble';
import { PRIMARY, BG, CARD, SURFACE, TEXT, TEXT2, BORDER } from '../lib/config';
import { Icon } from '../components/Icon';
import type { Message, RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Route = RouteProp<RootStackParamList, 'Chat'>;

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  assigned: 'Acceptée',
  in_progress: 'En route',
  done: 'Terminée',
  cancelled: 'Annulée',
};

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { delivery: initDelivery } = route.params;

  const { activeDelivery, messages, loadingMessages, loadMessages, appendMessage, setActiveDelivery, updateActiveStatus, removeActiveCourse, setPendingCancellation } =
    useDeliveriesStore();

  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sending, setSending] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recSecondsRef = useRef(0);
  const [ccPhone, setCcPhone] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const delivery = activeDelivery ?? initDelivery;
  const isClosed = delivery.status === 'done' || delivery.status === 'cancelled';

  // Numéro Call Center
  useEffect(() => {
    api<{ ccPhone: string | null }>('/api/drivers/config')
      .then((d) => setCcPhone(d.ccPhone))
      .catch(() => {});
  }, []);

  // Initialisation
  useEffect(() => {
    setActiveDelivery(initDelivery);
    loadMessages(initDelivery.id);

    socketService.joinRoom(initDelivery.id);

    const onMsg = (m: Message) => {
      appendMessage(m);
      listRef.current?.scrollToEnd({ animated: true });
    };
    const onCancelled = ({ deliveryId }: { deliveryId: string }) => {
      if (deliveryId === initDelivery.id) {
        updateActiveStatus('cancelled');
        Alert.alert('Course annulée', 'Cette course a été annulée.');
      }
    };
    // Re-joindre la room après reconnexion socket (réseau coupé, app background)
    const onConnect = () => socketService.joinRoom(initDelivery.id);

    socketService.on('client_message', onMsg);
    socketService.on('delivery_cancelled', onCancelled);
    socketService.on('connect', onConnect);
    return () => {
      socketService.off('client_message', onMsg);
      socketService.off('delivery_cancelled', onCancelled);
      socketService.off('connect', onConnect);
      setActiveDelivery(null);
    };
  }, []);

  // Scroll en bas à l'arrivée des messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  // ─── Envoi texte ──────────────────────────────────────────────────────────
  const sendText = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    setSending(true);
    try {
      const { message } = await api<{ message: Message }>(
        `/api/deliveries/${delivery.id}/message`,
        { method: 'POST', body: { type: 'text', content } }
      );
      appendMessage({ ...message, senderRole: 'driver', type: 'text', content, meta: null });
      listRef.current?.scrollToEnd({ animated: true });
    } catch {
      setText(content);
      Alert.alert('Erreur', 'Message non envoyé. Réessayez.');
    } finally {
      setSending(false);
    }
  }, [text, sending, delivery.id]);

  // ─── Enregistrement audio ─────────────────────────────────────────────────
  const _startRecordingTimer = () => {
    recSecondsRef.current = 0;
    setRecSeconds(0);
    recTimerRef.current = setInterval(() => {
      recSecondsRef.current += 1;
      setRecSeconds(recSecondsRef.current);
    }, 1000);
  };

  const _stopRecordingTimer = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecSeconds(0);
  };

  const startRecording = useCallback(async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'Activez le microphone dans les paramètres.');
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    setRecording(rec);
    _startRecordingTimer();
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    _stopRecordingTimer();
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    if (uri) await uploadAndSendMedia('audio', uri, 'audio/mp4', 'm4a');
  }, [recording]);

  const cancelRecording = useCallback(async () => {
    if (!recording) return;
    _stopRecordingTimer();
    await recording.stopAndUnloadAsync();
    setRecording(null);
  }, [recording]);

  // ─── Image ────────────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'Activez la galerie dans les paramètres.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const mime = asset.mimeType ?? `image/${ext}`;
      await uploadAndSendMedia('image', asset.uri, mime, ext);
    }
  }, [delivery.id]);

  // ─── Localisation ─────────────────────────────────────────────────────────
  const sendLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'Activez la localisation dans les paramètres.');
      return;
    }
    setSending(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { message } = await api<{ message: Message }>(
        `/api/deliveries/${delivery.id}/message`,
        {
          method: 'POST',
          body: {
            type: 'location',
            meta: { lat: loc.coords.latitude, lng: loc.coords.longitude, label: 'Ma position' },
          },
        }
      );
      appendMessage({
        ...message,
        senderRole: 'driver',
        type: 'location',
        content: null,
        meta: { lat: loc.coords.latitude, lng: loc.coords.longitude, label: 'Ma position' },
      });
    } catch {
      Alert.alert('Erreur', 'Impossible d\'envoyer la localisation.');
    } finally {
      setSending(false);
    }
  }, [delivery.id]);

  // ─── Helper upload local ──────────────────────────────────────────────────
  const uploadAndSendMedia = async (
    type: 'audio' | 'image',
    uri: string,
    mime: string,
    ext: string
  ) => {
    setSending(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri, type: mime, name: `file.${ext}` } as any);
      const { url } = await uploadFile('/api/upload', formData);

      const { message } = await api<{ message: Message }>(
        `/api/deliveries/${delivery.id}/message`,
        { method: 'POST', body: { type, content: url } }
      );
      appendMessage({ ...message, senderRole: 'driver', type, content: url, meta: null });
      listRef.current?.scrollToEnd({ animated: true });
    } catch {
      Alert.alert('Erreur', "Envoi du fichier échoué. Vérifiez votre connexion.");
    } finally {
      setSending(false);
    }
  };

  // ─── Navigation GPS ────────────────────────────────────────────────────────
  const openNavigation = useCallback((address: string, label: string) => {
    const encoded = encodeURIComponent(address);
    Alert.alert(`Naviguer vers ${label}`, 'Ouvrir avec :', [
      {
        text: 'Google Maps',
        onPress: () =>
          Linking.openURL(
            `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`
          ),
      },
      {
        text: 'Waze',
        onPress: () =>
          Linking.openURL(`waze://?q=${encoded}&navigate=yes`).catch(() =>
            Linking.openURL(`https://waze.com/ul?q=${encoded}&navigate=yes`)
          ),
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, []);

  // ─── Mise à jour statut ───────────────────────────────────────────────────
  const updateStatus = useCallback(
    async (status: 'in_progress' | 'done' | 'cancelled') => {
      const labels: Record<string, string> = {
        in_progress: 'Marquer "En route" ?',
        done: 'Marquer la course comme terminée ?',
        cancelled: 'Annuler la course ?',
      };
      Alert.alert('Confirmation', labels[status], [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui',
          style: status === 'cancelled' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await api(`/api/deliveries/${delivery.id}/status`, {
                method: 'POST',
                body: { status },
              });
              updateActiveStatus(status);
              // Proposer navigation après confirmation "En route" → restaurant en premier
              if (status === 'in_progress' && delivery.pickupAddress) {
                openNavigation(delivery.pickupAddress, 'le restaurant');
              }
              if (status === 'done' || status === 'cancelled') {
                removeActiveCourse(delivery.id);
                setTimeout(() => navigation.goBack(), 1500);
              }
            } catch {
              Alert.alert('Erreur', 'Impossible de mettre à jour le statut.');
            }
          },
        },
      ]);
    },
    [delivery.id, delivery.pickupAddress, navigation, openNavigation]
  );

  // ─── Annulation livreur ───────────────────────────────────────────────────
  const handleDriverCancel = useCallback(() => {
    Alert.alert(
      'Annuler la course ?',
      'La course sera remise en attente pour réassignation. Vous devrez indiquer la raison.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            try {
              await api(`/api/deliveries/${delivery.id}/driver-cancel`, { method: 'POST' });
              removeActiveCourse(delivery.id);
              setPendingCancellation({
                deliveryId: delivery.id,
                clientAlias: delivery.clientAlias ?? 'Course',
              });
              navigation.goBack();
            } catch {
              Alert.alert('Erreur', "Impossible d'annuler la course.");
            }
          },
        },
      ]
    );
  }, [delivery.id, delivery.clientAlias, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header sombre — style screenshot */}
      <View style={styles.chatHeader}>
        <TouchableOpacity style={styles.headerCircleBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={22} color="#fff" strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{(delivery.clientAlias ?? '?')[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{delivery.clientAlias}</Text>
          <Text style={styles.headerStatus}>{STATUS_LABELS[delivery.status ?? 'assigned']}</Text>
        </View>
        <TouchableOpacity
          style={styles.headerCircleBtn}
          onPress={() => {
            if (!ccPhone) {
              Alert.alert('Appel indisponible', 'Le numéro du Call Center n\'est pas configuré.');
              return;
            }
            Linking.openURL(`tel:${ccPhone}`);
          }}
        >
          <Icon name="phone" size={18} color="#fff" strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* Barre de progression commande */}
      {delivery.status !== 'cancelled' && (
        <View style={styles.progressWrap}>
          <View style={styles.stepsRow}>
            {(['Acceptée', 'En route', 'Terminée'] as const).map((label, i) => {
              const stepIdx = ({ assigned: 0, in_progress: 1, done: 2 } as Record<string, number>)[delivery.status ?? 'assigned'] ?? 0;
              const filled = i < stepIdx;
              const current = i === stepIdx;
              return (
                <View key={i} style={styles.stepWrap}>
                  {i > 0 && <View style={[styles.stepLine, (filled || current) && styles.stepLineDone]} />}
                  <View style={styles.stepItem}>
                    <View style={[styles.stepDot, filled ? styles.stepDotDone : current ? styles.stepDotCurrent : styles.stepDotPending]} />
                    <Text style={[styles.stepLabel, filled ? styles.stepLabelDone : current ? styles.stepLabelCurrent : styles.stepLabelPending]}>
                      {label}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Messages */}
      {loadingMessages ? (
        <ActivityIndicator color={PRIMARY} style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        />
      )}

      {/* Boutons statut */}
      {!isClosed && (
        <View style={styles.statusBar}>
          {delivery.status === 'assigned' && (
            <StatusBtn label="🛵  En route" color={PRIMARY} onPress={() => updateStatus('in_progress')} />
          )}
          {delivery.status === 'in_progress' && (
            <StatusBtn label="✅  Terminé" color="#4caf50" onPress={() => updateStatus('done')} />
          )}
          {(delivery.status === 'assigned' || delivery.status === 'in_progress') && (
            <StatusBtn label="✕  Annuler" color="#f44336" onPress={handleDriverCancel} />
          )}
        </View>
      )}

      {/* Boutons navigation GPS */}
      {!isClosed && (delivery.pickupAddress || delivery.dropoffAddress) && (
        <View style={styles.navBar}>
          {delivery.pickupAddress && (
            <NavBtn
              label="🍽  Restaurant"
              onPress={() => openNavigation(delivery.pickupAddress!, 'le restaurant')}
            />
          )}
          {delivery.dropoffAddress && (
            <NavBtn
              label="📍  Client"
              onPress={() => openNavigation(delivery.dropoffAddress!, 'le client')}
            />
          )}
        </View>
      )}

      {/* Zone de saisie */}
      {!isClosed && !recording && (
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={pickImage} disabled={sending}>
            <Icon name="image" size={20} color={TEXT2} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={sendLocation} disabled={sending}>
            <Icon name="location" size={20} color={TEXT2} strokeWidth={1.75} />
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            placeholder="Message..."
            placeholderTextColor={TEXT2}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            onSubmitEditing={sendText}
          />

          {text.trim() ? (
            <TouchableOpacity style={styles.micBtn} onPress={sendText} disabled={sending}>
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Icon name="send" size={18} color="#fff" />
              }
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.micBtn} onPress={startRecording} disabled={sending}>
              <Icon name="mic" size={20} color="#fff" strokeWidth={1.75} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Barre enregistrement WhatsApp style */}
      {!isClosed && !!recording && (
        <View style={styles.recBar}>
          <TouchableOpacity style={styles.recCancel} onPress={cancelRecording}>
            <Icon name="trash" size={20} color={TEXT2} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.recDot} />
          <Text style={styles.recTimer}>
            {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}
          </Text>
          <RecordingWave />
          <TouchableOpacity style={styles.micBtn} onPress={stopRecording}>
            <Icon name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {isClosed && (
        <View style={styles.closedBanner}>
          <Text style={styles.closedBannerText}>
            {delivery.status === 'done' ? '✅ Course terminée' : '✕ Course annulée'}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function StatusBtn({
  label,
  color = PRIMARY,
  onPress,
}: {
  label: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.statusBtn, { backgroundColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={styles.statusBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function NavBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navBtn} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.navBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Hauteurs (dp) et durées (ms) pour 30 barres fines — motif waveform
const BAR_H = [4,14,22,8,18,6,20,12,26,6,16,10,24,8,18,4,14,20,6,26,10,16,8,22,12,6,18,14,24,8];
const BAR_D = [250,285,220,300,260,280,240,305,265,235,255,290,215,295,270,275,245,310,255,230,250,275,225,315,260,270,240,285,270,240];
const N_BARS = BAR_H.length;

function RecordingWave() {
  const anims = useRef(Array.from({ length: N_BARS }, () => new Animated.Value(0.3))).current;

  useEffect(() => {
    const loops = anims.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: BAR_D[i], useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: BAR_D[i], useNativeDriver: true }),
        ])
      )
    );
    // Décaler le démarrage pour éviter que toutes les barres bougent en même temps
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 18));
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={recWaveStyles.wrap}>
      {anims.map((val, i) => (
        <Animated.View
          key={i}
          style={[recWaveStyles.bar, { height: BAR_H[i], transform: [{ scaleY: val }] }]}
        />
      ))}
    </View>
  );
}

const recWaveStyles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 32, overflow: 'hidden' },
  bar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.4)' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F0F0F5' },

  // Header sombre
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: PRIMARY,
    paddingTop: 50, paddingBottom: 14, paddingHorizontal: 14,
  },
  headerCircleBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  headerBackIcon: { color: '#fff', fontSize: 24, fontWeight: '300', marginTop: -2 },
  headerPhoneIcon: { fontSize: 16 },
  headerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  headerAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerStatus: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 },

  messageList: { paddingVertical: 12, paddingHorizontal: 2, flexGrow: 1 },

  // Status buttons
  statusBar: {
    flexDirection: 'row', gap: 8, padding: 10,
    backgroundColor: CARD, borderTopWidth: 0.5, borderTopColor: BORDER,
  },
  statusBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  statusBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Navigation GPS
  navBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 10, paddingBottom: 10, paddingTop: 0,
    backgroundColor: CARD,
  },
  navBtn: {
    flex: 1, borderRadius: 10, paddingVertical: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  navBtnText: { color: '#1565C0', fontWeight: '700', fontSize: 13 },

  // Input bar — screenshot exact
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 10, backgroundColor: CARD,
    borderTopWidth: 0.5, borderTopColor: BORDER,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: SURFACE,
    justifyContent: 'center', alignItems: 'center',
  },
  iconTxt: { fontSize: 18 },
  textInput: {
    flex: 1, backgroundColor: '#F0F0F5', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    color: TEXT, fontSize: 15, maxHeight: 100,
  },
  micBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
  },
  sendIcon: { color: '#fff', fontSize: 15, marginLeft: 1 },

  // Recording bar
  recBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, backgroundColor: CARD,
    borderTopWidth: 0.5, borderTopColor: BORDER,
  },
  recCancel: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: SURFACE,
  },
  recDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#FF3B30',
    flexShrink: 0,
  },
  recTimer: {
    fontSize: 14, fontWeight: '700',
    color: TEXT, minWidth: 34,
    fontVariant: ['tabular-nums'],
  },

  // Progress bar
  progressWrap: { backgroundColor: BG, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  stepsRow: { flexDirection: 'row', alignItems: 'center' },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepLine: { flex: 1, height: 2, backgroundColor: '#2a2a2a' },
  stepLineDone: { backgroundColor: PRIMARY },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 12, height: 12, borderRadius: 6 },
  stepDotDone: { backgroundColor: PRIMARY },
  stepDotCurrent: { backgroundColor: PRIMARY, borderWidth: 2, borderColor: PRIMARY },
  stepDotPending: { backgroundColor: '#ccc', borderWidth: 1, borderColor: '#bbb' },
  stepLabel: { fontSize: 9, marginTop: 4, textAlign: 'center', width: 52 },
  stepLabelDone: { color: PRIMARY, fontWeight: '600' },
  stepLabelCurrent: { color: PRIMARY, fontWeight: '700' },
  stepLabelPending: { color: '#aaa' },

  // Closed
  closedBadge: {
    backgroundColor: SURFACE, color: TEXT2, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, fontSize: 12,
  },
  closedBanner: {
    padding: 16, backgroundColor: CARD, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  closedBannerText: { color: TEXT2, fontSize: 15 },
});
