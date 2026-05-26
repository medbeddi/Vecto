import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { api, uploadToR2 } from '../lib/api';
import { MessageBubble } from '../components/MessageBubble';
import { BRAND, BG, CARD, SURFACE } from '../lib/config';
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

  const { activeDelivery, messages, loadingMessages, loadMessages, appendMessage, setActiveDelivery, updateActiveStatus, removeActiveCourse } =
    useDeliveriesStore();

  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const delivery = activeDelivery ?? initDelivery;
  const isClosed = delivery.status === 'done' || delivery.status === 'cancelled';

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

    socketService.on('client_message', onMsg);
    socketService.on('delivery_cancelled', onCancelled);
    return () => {
      socketService.off('client_message', onMsg);
      socketService.off('delivery_cancelled', onCancelled);
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
  const toggleRecording = useCallback(async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) await uploadAndSendMedia('audio', uri, 'audio/mp4', 'm4a');
      return;
    }
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
  }, [recording, delivery.id]);

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
      const token = await import('../lib/storage').then(m => m.storage.getAccessToken());
      const formData = new FormData();
      formData.append('file', { uri, type: mime, name: `file.${ext}` } as any);

      const { API_BASE } = await import('../lib/config');
      const uploadRes = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('upload failed');
      const { url } = await uploadRes.json();

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
    [delivery.id, navigation]
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Info course */}
      <View style={styles.infoBar}>
        <View>
          <Text style={styles.infoAlias}>{delivery.clientAlias}</Text>
          <Text style={styles.infoStatus}>{STATUS_LABELS[delivery.status ?? 'assigned']}</Text>
        </View>
        {isClosed && <Text style={styles.closedBadge}>Fermée</Text>}
      </View>

      {/* Messages */}
      {loadingMessages ? (
        <ActivityIndicator color={BRAND} style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Boutons statut */}
      {!isClosed && (
        <View style={styles.statusBar}>
          {delivery.status === 'assigned' && (
            <StatusBtn label="🛵  En route" onPress={() => updateStatus('in_progress')} />
          )}
          {delivery.status === 'in_progress' && (
            <StatusBtn label="✅  Terminé" color="#4caf50" onPress={() => updateStatus('done')} />
          )}
          {(delivery.status === 'assigned' || delivery.status === 'in_progress') && (
            <StatusBtn label="✕  Annuler" color="#f44336" onPress={() => updateStatus('cancelled')} />
          )}
        </View>
      )}

      {/* Zone de saisie */}
      {!isClosed && (
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={sendLocation} disabled={sending}>
            <Text style={styles.iconTxt}>📍</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconBtn} onPress={pickImage} disabled={sending}>
            <Text style={styles.iconTxt}>🖼</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconBtn, recording && styles.iconBtnRec]}
            onPress={toggleRecording}
            disabled={sending && !recording}
          >
            <Text style={styles.iconTxt}>{recording ? '⏹' : '🎙'}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            placeholder={recording ? 'Enregistrement...' : 'Message...'}
            placeholderTextColor="#555"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            editable={!recording}
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
            onPress={sendText}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendIcon}>➤</Text>
            )}
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
  color = BRAND,
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  infoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  infoAlias: { color: '#fff', fontWeight: '700', fontSize: 16 },
  infoStatus: { color: '#888', fontSize: 12, marginTop: 2 },
  closedBadge: {
    backgroundColor: '#333',
    color: '#888',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
  },
  messageList: { paddingVertical: 12, flexGrow: 1 },
  statusBar: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  statusBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statusBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: SURFACE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnRec: { backgroundColor: '#f44336' },
  iconTxt: { fontSize: 18 },
  textInput: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnOff: { opacity: 0.35 },
  sendIcon: { color: '#fff', fontSize: 16, marginLeft: 2 },
  closedBanner: {
    padding: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  closedBannerText: { color: '#888', fontSize: 15 },
});
