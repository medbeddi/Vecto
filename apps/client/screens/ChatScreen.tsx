import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
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

const BRAND = '#E85D04';
const BG = '#111111';

const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ En attente de livreur',
  assigned: '🔔 Livreur assigné',
  in_progress: '🚚 En cours de livraison',
  done: '✅ Livraison terminée',
  cancelled: '❌ Annulée',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#ffd700', assigned: '#00d4d4',
  in_progress: '#4db8ff', done: '#4dff88', cancelled: '#ff6b6b',
};

export default function ChatScreen({ route }: Props) {
  const { phone } = route.params;
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const listRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgCountRef = useRef(0);

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
      Alert.alert('Erreur', 'Message non envoyé. Backend démarré ?');
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      send('location', { latitude: 18.0735, longitude: -15.9582, name: 'Marché Capitale', address: 'Nouakchott' });
      return;
    }
    setSending(true);
    try {
      const loc = await Location.getCurrentPositionAsync({});
      await send('location', {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        name: 'Ma position',
        address: `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`,
      });
    } catch { setSending(false); }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const mime = asset.mimeType ?? `image/${ext}`;
    setSending(true);
    try {
      const { url } = await uploadFile(asset.uri, mime, ext);
      await send('image', { id: url, mime_type: mime });
    } catch { Alert.alert('Erreur', "Upload image échoué."); }
    setSending(false);
  };

  const toggleRecording = async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
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
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isClient = item.sender_role === 'client';
    let content = '';
    if (item.type === 'text') content = item.content ?? '';
    else if (item.type === 'location') {
      const m = item.meta as any;
      content = `📍 ${m?.label ?? m?.name ?? `${m?.lat}, ${m?.lng}`}`;
    } else if (item.type === 'audio') content = '🎵 Message audio';
    else if (item.type === 'image') content = '🖼️ Image';

    return (
      <View style={[s.bubble, isClient ? s.bubbleClient : s.bubbleDriver]}>
        <Text style={[s.role, { color: isClient ? '#ffb380' : '#80c8ff' }]}>
          {isClient ? 'Vous' : 'Livreur'}
        </Text>
        <Text style={s.bubbleText}>{content}</Text>
        <Text style={s.time}>
          {new Date(item.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
      <StatusBar style="light" />

      {delivery && (
        <View style={[s.statusBar, { borderColor: STATUS_COLORS[delivery.status] ?? '#444' }]}>
          <Text style={[s.statusText, { color: STATUS_COLORS[delivery.status] ?? '#aaa' }]}>
            {STATUS_LABELS[delivery.status] ?? delivery.status}
          </Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>Envoyez un message pour commander une livraison.</Text>
          </View>
        }
      />

      <View style={s.bar}>
        <TouchableOpacity style={s.iconBtn} onPress={sendLocation} disabled={sending}>
          <Text style={s.iconTxt}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={pickImage} disabled={sending}>
          <Text style={s.iconTxt}>🖼</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.iconBtn, recording ? s.iconBtnRec : null]}
          onPress={toggleRecording}
          disabled={sending && !recording}
        >
          <Text style={s.iconTxt}>{recording ? '⏹' : '🎙'}</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder={recording ? 'Enregistrement...' : 'Votre message...'}
          placeholderTextColor="#555"
          value={text}
          onChangeText={setText}
          returnKeyType="send"
          onSubmitEditing={sendText}
          editable={!sending && !recording}
          multiline
        />
        <TouchableOpacity
          style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnOff]}
          onPress={sendText}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendTxt}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  statusBar: { backgroundColor: '#1a1a1a', padding: 10, borderBottomWidth: 1, alignItems: 'center' },
  statusText: { fontWeight: '600', fontSize: 14 },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#444', textAlign: 'center', fontSize: 15, lineHeight: 22 },
  bubble: { maxWidth: '75%', padding: 12, borderRadius: 14 },
  bubbleClient: { alignSelf: 'flex-end', backgroundColor: BRAND, borderBottomRightRadius: 4 },
  bubbleDriver: { alignSelf: 'flex-start', backgroundColor: '#1e1e1e', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  role: { fontSize: 11, fontWeight: '600', marginBottom: 3 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  time: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4, textAlign: 'right' },
  bar: { flexDirection: 'row', padding: 10, gap: 8, backgroundColor: '#1a1a1a', borderTopWidth: 1, borderTopColor: '#2a2a2a', alignItems: 'flex-end' },
  iconBtn: { width: 42, height: 42, backgroundColor: '#2a2a2a', borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  iconBtnRec: { backgroundColor: '#f44336' },
  iconTxt: { fontSize: 18 },
  input: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 21, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 42, height: 42, backgroundColor: BRAND, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
