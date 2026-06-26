import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Modal,
  KeyboardAvoidingView, Linking, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  getActiveDelivery, sendMessage, getMessages, uploadFile,
  getClientToken,
} from '../lib/api';
import type { Message } from '../lib/api';
import { connectClientSocket } from '../lib/socket';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const BRAND = '#25D366';
const BG = '#0a0a0a';
const BUBBLE_ME = '#005C4B';
const BUBBLE_OTHER = '#1F2C34';

const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ En attente de livreur',
  assigned: '🔔 Livreur assigné',
  in_progress: '🚚 En cours',
  done: '✅ Livraison terminée',
  cancelled: '❌ Annulée',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#ffd700', assigned: '#00d4d4',
  in_progress: '#4db8ff', done: BRAND, cancelled: '#ff6b6b',
};

export default function ChatScreen({ route, navigation }: Props) {
  const { deliveryId } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('assigned');
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isClosed = status === 'done' || status === 'cancelled';

  // Chargement initial
  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(async () => {
      try {
        const { delivery } = await getActiveDelivery();
        if (delivery) setStatus(delivery.status);
      } catch {}
    }, 5000);

    const token = getClientToken();
    if (!token) return () => { if (pollRef.current) clearInterval(pollRef.current); };

    const socket = connectClientSocket(token);

    const onConnect = () => socket.emit('join_delivery', { deliveryId });
    const onDriverMessage = (m: Message) => {
      setMessages(prev => [...prev, { ...m, senderRole: 'driver' }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onCancelled = () => {
      setStatus('cancelled');
      Alert.alert('Course annulée', 'Cette course a été annulée par le livreur.');
    };

    socket.on('connect', onConnect);
    socket.on('driver_message', onDriverMessage);
    socket.on('delivery_cancelled', onCancelled);

    // Rejoindre immédiatement si déjà connecté
    if (socket.connected) socket.emit('join_delivery', { deliveryId });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      socket.off('connect', onConnect);
      socket.off('driver_message', onDriverMessage);
      socket.off('delivery_cancelled', onCancelled);
    };
  }, [deliveryId]);

  const loadMessages = useCallback(async () => {
    try {
      const { messages: msgs } = await getMessages(deliveryId);
      setMessages(msgs);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    } catch {}
  }, [deliveryId]);

  const send = useCallback(async (type: string, content?: string | null, meta?: any) => {
    setSending(true);
    try {
      const { message } = await sendMessage(deliveryId, { type, content, meta });
      setMessages(prev => [...prev, { ...message, senderRole: 'client' }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      Alert.alert('Erreur', 'Message non envoyé.');
    } finally {
      setSending(false);
    }
  }, [deliveryId]);

  const sendText = useCallback(() => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    send('text', t);
  }, [text, sending, send]);

  const sendLocation = useCallback(async () => {
    const { status: s } = await Location.requestForegroundPermissionsAsync();
    if (s !== 'granted') { Alert.alert('Permission refusée'); return; }
    setSending(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await send('location', null, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        label: 'Ma position',
      });
    } catch { setSending(false); }
  }, [send]);

  const pickImage = useCallback(async () => {
    const { status: s } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (s !== 'granted') { Alert.alert('Permission refusée'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const mime = asset.mimeType ?? `image/${ext}`;
    setSending(true);
    try {
      const { url } = await uploadFile(asset.uri, mime, ext);
      await send('image', url);
    } catch { Alert.alert('Erreur', "Upload image échoué."); setSending(false); }
  }, [send]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      if (recTimer.current) clearInterval(recTimer.current);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null); setRecSeconds(0);
      if (uri) {
        setSending(true);
        try {
          const { url } = await uploadFile(uri, 'audio/m4a', 'm4a');
          await send('audio', url);
        } catch { Alert.alert('Erreur', "Upload audio échoué."); setSending(false); }
      }
      return;
    }
    const { status: s } = await Audio.requestPermissionsAsync();
    if (s !== 'granted') { Alert.alert('Permission refusée'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec); setRecSeconds(0);
    recTimer.current = setInterval(() => setRecSeconds(n => n + 1), 1000);
  }, [recording, send]);

  const playAudio = useCallback(async (uri: string) => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      if (playingUri === uri) { setPlayingUri(null); return; }
    }
    setPlayingUri(uri);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) { setPlayingUri(null); sound.unloadAsync(); soundRef.current = null; }
      });
    } catch { setPlayingUri(null); }
  }, [playingUri]);

  const openLocation = useCallback((lat: number, lng: number, label?: string) => {
    const encoded = encodeURIComponent(label ?? `${lat},${lng}`);
    const url = Platform.OS === 'ios'
      ? `maps://?q=${encoded}&ll=${lat},${lng}`
      : `geo:${lat},${lng}?q=${encoded}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
    });
  }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.senderRole === 'client';
    const time = new Date(item.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    let content = null;

    if (item.type === 'text') {
      content = <Text style={styles.msgText}>{item.content}</Text>;
    } else if (item.type === 'image' && item.content) {
      content = (
        <TouchableOpacity onPress={() => setFullscreenImg(item.content!)} activeOpacity={0.9}>
          <Image source={{ uri: item.content }} style={styles.msgImage} resizeMode="cover" />
        </TouchableOpacity>
      );
    } else if (item.type === 'audio' && item.content) {
      const isPlaying = playingUri === item.content;
      content = (
        <TouchableOpacity style={styles.audioBtn} onPress={() => playAudio(item.content!)}>
          <Text style={styles.audioIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          <View style={styles.audioBar} />
          <Text style={styles.audioLabel}>{isPlaying ? 'En cours...' : 'Message vocal'}</Text>
        </TouchableOpacity>
      );
    } else if (item.type === 'location') {
      const m = item.meta ?? {};
      const lat = m.lat ?? m.latitude;
      const lng = m.lng ?? m.longitude;
      content = (
        <TouchableOpacity style={styles.locBubble} onPress={() => lat && openLocation(lat, lng, m.label)}>
          <Text style={styles.locIcon}>📍</Text>
          <View>
            <Text style={styles.locText}>{m.label ?? 'Position'}</Text>
            {lat ? <Text style={styles.locSub}>Appuyer pour ouvrir</Text> : null}
          </View>
        </TouchableOpacity>
      );
    } else {
      content = <Text style={styles.msgText}>{item.content ?? `[${item.type}]`}</Text>;
    }

    return (
      <View style={[styles.row, isMe ? styles.rowMe : styles.rowOther]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          {!isMe && <Text style={styles.senderName}>Livreur</Text>}
          {content}
          <Text style={styles.msgTime}>{time}{isMe ? ' ✓' : ''}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <StatusBar style="light" />

      {/* Modal image plein écran */}
      <Modal visible={!!fullscreenImg} transparent animationType="fade" onRequestClose={() => setFullscreenImg(null)}>
        <View style={styles.imgModal}>
          <TouchableOpacity style={styles.imgModalClose} onPress={() => setFullscreenImg(null)}>
            <Text style={styles.imgModalCloseText}>✕</Text>
          </TouchableOpacity>
          {fullscreenImg && (
            <Image source={{ uri: fullscreenImg }} style={styles.imgModalImg} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* Barre de progression commande */}
      <View style={styles.progressWrap}>
        {status === 'cancelled' ? (
          <Text style={styles.cancelledBanner}>❌ Course annulée</Text>
        ) : (
          <View style={styles.stepsRow}>
            {(['Envoyée', 'Assignée', 'En route', 'Livrée'] as const).map((label, i) => {
              const stepIdx = ({ pending: 0, assigned: 1, in_progress: 2, done: 3 } as Record<string, number>)[status] ?? 0;
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
        )}
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m, i) => m.id ?? String(i)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🛵</Text>
            <Text style={styles.emptyTitle}>Course en attente</Text>
            <Text style={styles.emptyText}>Un livreur a accepté votre commande. Vous pouvez communiquer ici.</Text>
          </View>
        }
      />

      {/* Saisie */}
      {!isClosed ? (
        recording ? (
          <View style={styles.recBar}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>🎙 {fmt(recSeconds)}</Text>
            <TouchableOpacity style={styles.recStop} onPress={toggleRecording}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Envoyer</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={async () => {
              if (recTimer.current) clearInterval(recTimer.current);
              await recording.stopAndUnloadAsync();
              setRecording(null); setRecSeconds(0);
            }}>
              <Text style={{ color: '#f44336', padding: 8 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.bar}>
            <TouchableOpacity style={styles.iconBtn} onPress={sendLocation} disabled={sending}>
              <Text style={styles.iconTxt}>📍</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={pickImage} disabled={sending}>
              <Text style={styles.iconTxt}>🖼</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={toggleRecording} disabled={sending}>
              <Text style={styles.iconTxt}>🎙</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="Message..."
              placeholderTextColor="#555"
              value={text}
              onChangeText={setText}
              returnKeyType="send"
              onSubmitEditing={sendText}
              editable={!sending}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
              onPress={sendText}
              disabled={!text.trim() || sending}
            >
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendIcon}>➤</Text>}
            </TouchableOpacity>
          </View>
        )
      ) : (
        <View style={styles.closedBanner}>
          <Text style={styles.closedText}>
            {status === 'done' ? '✅ Livraison terminée' : '❌ Course annulée'}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  progressWrap: { backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  cancelledBanner: { color: '#ff6b6b', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  stepsRow: { flexDirection: 'row', alignItems: 'center' },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepLine: { flex: 1, height: 2, backgroundColor: '#2a2a2a' },
  stepLineDone: { backgroundColor: BRAND },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 12, height: 12, borderRadius: 6 },
  stepDotDone: { backgroundColor: BRAND },
  stepDotCurrent: { backgroundColor: '#fff', borderWidth: 2, borderColor: BRAND },
  stepDotPending: { backgroundColor: '#444', borderWidth: 1, borderColor: '#666' },
  stepLabel: { fontSize: 9, marginTop: 4, textAlign: 'center', width: 48 },
  stepLabelDone: { color: BRAND, fontWeight: '600' },
  stepLabelCurrent: { color: '#fff', fontWeight: '700' },
  stepLabelPending: { color: '#666' },
  list: { padding: 12, gap: 4, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptyText: { color: '#555', textAlign: 'center', fontSize: 13, lineHeight: 20, paddingHorizontal: 30 },
  row: { marginVertical: 2 },
  rowMe: { alignItems: 'flex-end' },
  rowOther: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 10, paddingBottom: 6 },
  bubbleMe: { backgroundColor: BUBBLE_ME, borderBottomRightRadius: 3 },
  bubbleOther: { backgroundColor: BUBBLE_OTHER, borderBottomLeftRadius: 3 },
  senderName: { color: BRAND, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  msgText: { color: '#e8e8e8', fontSize: 15, lineHeight: 21 },
  msgTime: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'right', marginTop: 4 },
  msgImage: { width: 220, height: 165, borderRadius: 8, marginBottom: 4 },
  audioBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 180 },
  audioIcon: { fontSize: 22 },
  audioBar: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2 },
  audioLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  locBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  locIcon: { fontSize: 22 },
  locText: { color: '#e8e8e8', fontSize: 14, fontWeight: '600' },
  locSub: { color: BRAND, fontSize: 11, marginTop: 2 },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 18 },
  input: { flex: 1, backgroundColor: '#1e1e1e', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: '#2a2a2a' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 15 },
  recBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#f44336' },
  recText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  recStop: { backgroundColor: BRAND, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  closedBanner: { padding: 16, backgroundColor: '#111', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#222' },
  closedText: { color: '#888', fontSize: 15 },
  imgModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  imgModalClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  imgModalCloseText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  imgModalImg: { width: '100%', height: '100%' },
});
