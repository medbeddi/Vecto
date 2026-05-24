import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, FlatList,
  Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { sendWhatsAppMessage, getConversation, uploadFile } from '../lib/api';
import type { Message, Delivery } from '../lib/api';
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

export default function ChatScreen({ route }: Props) {
  const { phone } = route.params;
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [showAttach, setShowAttach] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgCountRef = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getConversation(phone);
      setMessages(data.messages);
      setDelivery(data.delivery);
      if (data.messages.length !== msgCountRef.current) {
        msgCountRef.current = data.messages.length;
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch {}
  }, [phone]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const send = async (type: string, body: any) => {
    setSending(true);
    try {
      await sendWhatsAppMessage(phone, type, body);
      setTimeout(load, 600);
    } catch {
      Alert.alert('Erreur', 'Message non envoyé.');
    }
    setSending(false);
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    send('text', t);
  };

  const sendLocation = async () => {
    setShowAttach(false);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'Activez la localisation dans les paramètres.');
      return;
    }
    setSending(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await send('location', {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        name: 'Ma position',
        address: `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`,
      });
    } catch { setSending(false); }
  };

  const pickFromGallery = async () => {
    setShowAttach(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    uploadImage(result.assets[0]);
  };

  const pickFromCamera = async () => {
    setShowAttach(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    uploadImage(result.assets[0]);
  };

  const uploadImage = async (asset: ImagePicker.ImagePickerAsset) => {
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const mime = asset.mimeType ?? `image/${ext}`;
    setSending(true);
    try {
      const { url } = await uploadFile(asset.uri, mime, ext);
      await send('image', { id: url, mime_type: mime });
    } catch { Alert.alert('Erreur', "Upload image échoué."); setSending(false); }
  };

  const toggleRecording = async () => {
    if (recording) {
      if (recTimer.current) clearInterval(recTimer.current);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setRecSeconds(0);
      if (uri) {
        setSending(true);
        try {
          const { url } = await uploadFile(uri, 'audio/m4a', 'm4a');
          await send('audio', { id: url, mime_type: 'audio/m4a' });
        } catch { Alert.alert('Erreur', "Upload audio échoué."); }
        setSending(false);
      }
      return;
    }
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec);
    setRecSeconds(0);
    recTimer.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
  };

  const playAudio = async (uri: string) => {
    if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; setPlayingUri(null); }
    if (playingUri === uri) return;
    setPlayingUri(uri);
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
    soundRef.current = sound;
    sound.setOnPlaybackStatusUpdate((s) => {
      if ('didJustFinish' in s && s.didJustFinish) { setPlayingUri(null); sound.unloadAsync(); }
    });
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.sender_role === 'client';
    const time = new Date(item.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let content = null;
    if (item.type === 'text') {
      content = <Text style={s.msgText}>{item.content}</Text>;
    } else if (item.type === 'image' && item.content) {
      content = (
        <Image source={{ uri: item.content }} style={s.msgImage} resizeMode="cover" />
      );
    } else if (item.type === 'audio' && item.content) {
      const isPlaying = playingUri === item.content;
      content = (
        <TouchableOpacity style={s.audioBtn} onPress={() => playAudio(item.content!)}>
          <Text style={s.audioIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          <View style={s.audioBar} />
          <Text style={s.audioLabel}>{isPlaying ? 'En cours...' : 'Message vocal'}</Text>
        </TouchableOpacity>
      );
    } else if (item.type === 'location') {
      const m = item.meta as any;
      content = (
        <View style={s.locBubble}>
          <Text style={s.locIcon}>📍</Text>
          <Text style={s.locText}>{m?.label ?? m?.name ?? `${m?.lat}, ${m?.lng}`}</Text>
        </View>
      );
    } else {
      content = <Text style={s.msgText}>{item.content ?? `[${item.type}]`}</Text>;
    }

    return (
      <View style={[s.row, isMe ? s.rowMe : s.rowOther]}>
        <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleOther]}>
          {!isMe && <Text style={s.senderName}>Livreur</Text>}
          {content}
          <Text style={s.msgTime}>{time} {isMe ? '✓' : ''}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <StatusBar style="light" />

      {/* Status bar */}
      {delivery && (
        <View style={[s.statusBar, { borderBottomColor: STATUS_COLORS[delivery.status] ?? '#333' }]}>
          <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[delivery.status] ?? '#333' }]} />
          <Text style={[s.statusText, { color: STATUS_COLORS[delivery.status] ?? '#aaa' }]}>
            {STATUS_LABELS[delivery.status] ?? delivery.status}
          </Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🛵</Text>
            <Text style={s.emptyTitle}>Bonjour !</Text>
            <Text style={s.emptyText}>Envoyez votre adresse, une photo ou un message vocal pour commander.</Text>
          </View>
        }
      />

      {/* Input bar */}
      {recording ? (
        <View style={s.recBar}>
          <View style={s.recDot} />
          <Text style={s.recText}>🎙 {formatTime(recSeconds)}</Text>
          <TouchableOpacity style={s.recStop} onPress={toggleRecording}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Envoyer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.recCancel} onPress={async () => {
            if (recTimer.current) clearInterval(recTimer.current);
            await recording.stopAndUnloadAsync();
            setRecording(null); setRecSeconds(0);
          }}>
            <Text style={{ color: '#ff6b6b' }}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.bar}>
          <TouchableOpacity style={s.attachBtn} onPress={() => setShowAttach(true)} disabled={sending}>
            <Text style={s.attachIcon}>＋</Text>
          </TouchableOpacity>
          <TextInput
            style={s.input}
            placeholder="Message..."
            placeholderTextColor="#555"
            value={text}
            onChangeText={setText}
            returnKeyType="send"
            onSubmitEditing={sendText}
            editable={!sending}
            multiline
          />
          {text.trim() ? (
            <TouchableOpacity style={s.sendBtn} onPress={sendText} disabled={sending}>
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendIcon}>➤</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.micBtn} onPress={toggleRecording} disabled={sending}>
              <Text style={s.micIcon}>🎙</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Attach modal */}
      <Modal visible={showAttach} transparent animationType="slide" onRequestClose={() => setShowAttach(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowAttach(false)}>
          <View style={s.attachSheet}>
            <Text style={s.attachTitle}>Joindre</Text>
            <View style={s.attachGrid}>
              <TouchableOpacity style={s.attachItem} onPress={pickFromCamera}>
                <View style={[s.attachCircle, { backgroundColor: '#E91E63' }]}>
                  <Text style={s.attachEmoji}>📷</Text>
                </View>
                <Text style={s.attachLabel}>Caméra</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.attachItem} onPress={pickFromGallery}>
                <View style={[s.attachCircle, { backgroundColor: '#9C27B0' }]}>
                  <Text style={s.attachEmoji}>🖼</Text>
                </View>
                <Text style={s.attachLabel}>Galerie</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.attachItem} onPress={sendLocation}>
                <View style={[s.attachCircle, { backgroundColor: '#2196F3' }]}>
                  <Text style={s.attachEmoji}>📍</Text>
                </View>
                <Text style={s.attachLabel}>Position</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#111', borderBottomWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600' },
  list: { padding: 12, gap: 4, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptyText: { color: '#555', textAlign: 'center', fontSize: 14, lineHeight: 22, paddingHorizontal: 30 },
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
  locBubble: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locIcon: { fontSize: 20 },
  locText: { color: '#e8e8e8', fontSize: 14, flex: 1 },
  // Input bar
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1e1e1e',
  },
  attachBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#222', alignItems: 'center', justifyContent: 'center',
  },
  attachIcon: { color: BRAND, fontSize: 22, fontWeight: '300' },
  input: {
    flex: 1, backgroundColor: '#1e1e1e', borderRadius: 21,
    paddingHorizontal: 16, paddingVertical: 10,
    color: '#fff', fontSize: 15, maxHeight: 120,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
  micBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  micIcon: { fontSize: 20 },
  // Recording bar
  recBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1e1e1e',
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#f44336' },
  recText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  recStop: { backgroundColor: BRAND, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  recCancel: { padding: 8 },
  // Attach sheet
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  attachSheet: {
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  attachTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 20 },
  attachGrid: { flexDirection: 'row', gap: 20 },
  attachItem: { alignItems: 'center', gap: 8 },
  attachCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  attachEmoji: { fontSize: 26 },
  attachLabel: { color: '#aaa', fontSize: 13 },
});
