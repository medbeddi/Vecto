import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { useAuthStore } from '../store/auth.store';
import { useDeliveriesStore } from '../store/deliveries.store';
import { socketService } from '../lib/socket';
import { api, uploadFile } from '../lib/api';
import { DeliveryCard } from '../components/DeliveryCard';
import {
  PRIMARY, BG, CARD, BORDER, TEXT, TEXT2, SURFACE, BRAND,
} from '../lib/config';
import { Icon } from '../components/Icon';
import type { Delivery, CCMessage, RootStackParamList } from '../types';

type Tab = 'courses' | 'chats' | 'admin' | 'profil';
type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

type IncomingOrder = {
  deliveryId: string;
  clientAlias: string;
  createdAt: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  price?: number | null;
  message: { type: string; content: string | null; meta: any };
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function MainScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('courses');
  const [adminUnread, setAdminUnread] = useState(0);

  useEffect(() => {
    const onCCMsg = () => {
      setActiveTab((t) => {
        if (t !== 'admin') setAdminUnread((n) => n + 1);
        return t;
      });
    };
    socketService.on('cc_message', onCCMsg);
    return () => socketService.off('cc_message', onCCMsg);
  }, []);

  const handleTabSelect = (t: Tab) => {
    setActiveTab(t);
    if (t === 'admin') setAdminUnread(0);
  };

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {activeTab === 'courses' && <CoursesTab />}
        {activeTab === 'chats' && <ChatsTab />}
        {activeTab === 'admin' && <AdminChatTab />}
        {activeTab === 'profil' && <ProfilTab />}
      </View>
      <BottomTabBar active={activeTab} onSelect={handleTabSelect} adminUnread={adminUnread} />
    </View>
  );
}

// ─── Onglet Courses ───────────────────────────────────────────────────────────

function CoursesTab() {
  const navigation = useNavigation<Nav>();
  const { driver } = useAuthStore();
  const {
    available, loadingDeliveries, loadAvailable, loadActiveCourses,
    upsertAvailable, removeAvailable, activeCourses, addActiveCourse,
  } = useDeliveriesStore();

  const [accepting, setAccepting] = useState<string | null>(null);
  const [dispo, setDispo] = useState(true);
  const [togglingDispo, setTogglingDispo] = useState(false);
  const [incomingOrder, setIncomingOrder] = useState<IncomingOrder | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  // Courses reçues par socket → ont un compte à rebours de 20s
  const socketDeliveryIds = useRef<Set<string>>(new Set());
  const modalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Charger la disponibilité initiale depuis le backend
  useEffect(() => {
    api<{ driver: { isAvailable: boolean } }>('/api/drivers/me')
      .then(({ driver: d }) => setDispo(d.isAvailable))
      .catch(() => {});
  }, []);

  const handleDispoToggle = async (value: boolean) => {
    setDispo(value);
    setTogglingDispo(true);
    try {
      await api('/api/drivers/me/availability', {
        method: 'PATCH',
        body: { isAvailable: value },
      });
    } catch {
      setDispo(!value); // rollback si erreur
      Alert.alert('Erreur', 'Impossible de changer la disponibilité.');
    } finally {
      setTogglingDispo(false);
    }
  };

  useEffect(() => {
    loadAvailable();
    loadActiveCourses();
    registerFCMToken();
    startLocationTracking();

    // Rechargement périodique en cas de socket déconnecté
    const pollInterval = setInterval(() => {
      if (!socketService.connected) loadAvailable();
    }, 15000);

    const onNewOrder = (order: IncomingOrder) => {
      socketDeliveryIds.current.add(order.deliveryId);
      setIncomingOrder(order);

      // Fermer le modal après 20s si le driver ne réagit pas
      if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
      modalTimerRef.current = setTimeout(() => {
        setIncomingOrder((prev) => prev?.deliveryId === order.deliveryId ? null : prev);
        modalTimerRef.current = null;
      }, 20 * 1000);

      upsertAvailable({
        id: order.deliveryId,
        clientAlias: order.clientAlias,
        createdAt: order.createdAt,
        status: 'pending',
        description: order.message.content ?? '',
        initialMediaType: order.message.type,
        initialMediaUrl: order.message.type === 'audio' ? order.message.content : null,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        price: order.price,
      });
      if (order.message.type === 'audio' && order.message.content) {
        playAudio(order.message.content);
      }
      Notifications.scheduleNotificationAsync({
        content: {
          title: '🛵 Nouvelle course',
          body: order.message.type === 'audio'
            ? `Message vocal de ${order.clientAlias}`
            : (order.message.content ?? `Course de ${order.clientAlias}`),
          data: { deliveryId: order.deliveryId },
        },
        trigger: null,
      });
    };

    const onOrderTaken = ({ deliveryId }: { deliveryId: string }) => {
      removeAvailable(deliveryId);
      socketDeliveryIds.current.delete(deliveryId);
      setIncomingOrder((prev) => prev?.deliveryId === deliveryId ? null : prev);
    };

    socketService.on('new_order', onNewOrder);
    socketService.on('order_taken', onOrderTaken);
    return () => {
      socketService.off('new_order', onNewOrder);
      socketService.off('order_taken', onOrderTaken);
      clearInterval(pollInterval);
      if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
    };
  }, []);

  const startLocationTracking = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      // Envoyer la position toutes les 30 secondes
      const sendLocation = async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          socketService.sendLocation(loc.coords.latitude, loc.coords.longitude);
        } catch {}
      };
      await sendLocation();
      const locInterval = setInterval(sendLocation, 30000);
      return () => clearInterval(locInterval);
    } catch {}
  };

  const playAudio = async (url: string) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) { sound.unloadAsync(); soundRef.current = null; }
      });
    } catch {}
  };

  const stopAudio = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
  };

  const handleAccept = useCallback(async (delivery: Delivery) => {
    setAccepting(delivery.id);
    socketDeliveryIds.current.delete(delivery.id);
    if (modalTimerRef.current) { clearTimeout(modalTimerRef.current); modalTimerRef.current = null; }
    try {
      const { delivery: updated } = await api<{ delivery: Delivery }>(
        `/api/deliveries/${delivery.id}/accept`,
        { method: 'POST' }
      );
      const accepted = { ...delivery, ...updated };
      removeAvailable(delivery.id);
      addActiveCourse(accepted);
      navigation.navigate('Chat', { delivery: accepted });
    } catch (err: any) {
      const msg = err.code === 'ALREADY_TAKEN'
        ? 'Cette course vient d\'être prise par un autre livreur.'
        : 'Impossible d\'accepter la course. Réessayez.';
      Alert.alert('Course indisponible', msg);
    } finally {
      setAccepting(null);
    }
  }, [navigation, removeAvailable, addActiveCourse]);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header — VECTO + Disponible toggle */}
      <View style={styles.header}>
        <Text style={styles.headerBrand}>VECTO</Text>
        <View style={styles.dispoRow}>
          <Text style={styles.dispoLabel}>Disponible</Text>
          <Switch
            value={dispo}
            onValueChange={handleDispoToggle}
            disabled={togglingDispo}
            trackColor={{ false: '#555', true: '#34C759' }}
            thumbColor="#fff"
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        </View>
      </View>

      {/* Modal nouvelle commande */}
      <Modal visible={!!incomingOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🛵 Nouvelle course</Text>
            <Text style={styles.modalAlias}>{incomingOrder?.clientAlias}</Text>

            {incomingOrder?.price != null && (
              <View style={styles.modalPriceBadge}>
                <Text style={styles.modalPriceText}>{incomingOrder.price} MRU</Text>
              </View>
            )}

            {(incomingOrder?.pickupAddress || incomingOrder?.dropoffAddress) && (
              <View style={styles.modalRoute}>
                {incomingOrder.pickupAddress ? (
                  <View style={styles.modalRouteRow}>
                    <View style={[styles.routeDot, { backgroundColor: '#34C759' }]} />
                    <Text style={styles.modalRouteText} numberOfLines={1}>{incomingOrder.pickupAddress}</Text>
                  </View>
                ) : null}
                {incomingOrder.dropoffAddress ? (
                  <View style={styles.modalRouteRow}>
                    <View style={[styles.routeDot, { backgroundColor: '#FF3B30' }]} />
                    <Text style={styles.modalRouteText} numberOfLines={1}>{incomingOrder.dropoffAddress}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {incomingOrder?.message.type === 'audio' ? (
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => incomingOrder?.message.content && playAudio(incomingOrder.message.content)}
              >
                <Text style={styles.playBtnText}>▶  Écouter le message vocal</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.modalMsg}>{incomingOrder?.message.content ?? ''}</Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.dismissBtn}
                onPress={() => { stopAudio(); setIncomingOrder(null); }}
              >
                <Text style={styles.dismissBtnText}>Ignorer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.acceptModalBtn, accepting ? styles.btnOff : null]}
                disabled={!!accepting}
                onPress={async () => {
                  if (!incomingOrder) return;
                  stopAudio();
                  const fake = {
                    id: incomingOrder.deliveryId,
                    clientAlias: incomingOrder.clientAlias,
                    status: 'pending',
                    createdAt: incomingOrder.createdAt,
                  } as Delivery;
                  setIncomingOrder(null);
                  await handleAccept(fake);
                }}
              >
                {accepting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.acceptModalBtnText}>✓  Accepter</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        data={available}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loadingDeliveries} onRefresh={loadAvailable} tintColor={PRIMARY} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Nouvelles courses</Text>
              <Text style={styles.sectionCount}>
                {available.length > 0 ? `${available.length} disponible${available.length > 1 ? 's' : ''}` : ''}
              </Text>
            </View>
            {activeCourses.length > 0 && (
              <View style={styles.activeSection}>
                {activeCourses.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={styles.activeCourseCard}
                    onPress={() => navigation.navigate('Chat', { delivery: d })}
                    activeOpacity={0.75}
                  >
                    <View style={styles.activeCourseLeft}>
                      <View style={styles.activeDot} />
                      <Text style={styles.activeCourseAlias}>{d.clientAlias}</Text>
                    </View>
                    <Text style={styles.activeCourseArrow}>→ Ouvrir</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          loadingDeliveries ? (
            <ActivityIndicator color={PRIMARY} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}>
              <Icon name="scooter" size={56} color={TEXT2} strokeWidth={1.5} />
              <Text style={styles.emptyText}>Aucune course disponible</Text>
              <Text style={styles.emptyHint}>Tirez pour actualiser</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <DeliveryCard
            delivery={item}
            onAccept={handleAccept}
            onRefuse={async (d) => {
              socketDeliveryIds.current.delete(d.id);
              try { await api(`/api/deliveries/${d.id}/refuse`, { method: 'POST' }); } catch {}
              removeAvailable(d.id);
            }}
            onExpire={(d) => {
              socketDeliveryIds.current.delete(d.id);
              removeAvailable(d.id);
            }}
            accepting={accepting === item.id}
            autoRemoveSec={socketDeliveryIds.current.has(item.id) ? 20 : undefined}
          />
        )}
      />
    </View>
  );
}

// ─── Onglet Chats (courses actives) ─────────────────────────────────────────

function ChatsTab() {
  const navigation = useNavigation<Nav>();
  const { activeCourses, loadActiveCourses, loadingDeliveries } = useDeliveriesStore();

  useEffect(() => { loadActiveCourses(); }, []);

  if (loadingDeliveries) {
    return <View style={styles.centerFill}><ActivityIndicator color={PRIMARY} /></View>;
  }

  const mediaIcon: Record<string, string> = {
    audio: '🎙', image: '📷', location: '📍', text: '💬',
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header sombre — Mes courses + count */}
      <View style={styles.header}>
        <Text style={styles.headerBrand}>Mes courses</Text>
        {activeCourses.length > 0 && (
          <Text style={styles.activeCountBadge}>
            {activeCourses.length} active{activeCourses.length > 1 ? 's' : ''}
          </Text>
        )}
      </View>
      {activeCourses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>Aucune discussion active</Text>
          <Text style={styles.emptyHint}>Acceptez une course pour discuter</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 20 }}>
          {activeCourses.map((d) => {
            const icon = mediaIcon[d.initialMediaType ?? 'text'] ?? '💬';
            const label = d.initialMediaType === 'audio' ? 'Vocal'
              : d.initialMediaType === 'image' ? 'Photo'
              : d.initialMediaType === 'location' ? 'Position'
              : 'Message';
            const t = new Date(d.createdAt);
            const timeStr = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
            return (
              <TouchableOpacity
                key={d.id}
                style={styles.chatRow}
                onPress={() => navigation.navigate('Chat', { delivery: d })}
                activeOpacity={0.75}
              >
                <View style={styles.chatAvatarWrap}>
                  <View style={styles.chatAvatar}>
                    <Text style={styles.chatAvatarText}>{(d.clientAlias ?? '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={styles.onlineDot} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.chatAlias}>{d.clientAlias}</Text>
                  <Text style={styles.chatLastMsg}>{icon}  {label}</Text>
                </View>
                <Text style={styles.chatTime}>{timeStr}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Onglet Admin — chat direct avec le call center ──────────────────────────

function AdminChatTab() {
  const [messages, setMessages]   = useState<CCMessage[]>([]);
  const [input,    setInput]      = useState('');
  const [sending,  setSending]    = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [ccPhone,  setCcPhone]    = useState<string | null>(null);
  const flatRef = useRef<FlatList<CCMessage>>(null);

  useEffect(() => {
    api<{ messages: CCMessage[] }>('/api/drivers/cc-chat')
      .then((d) => {
        setMessages(d.messages ?? []);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 120);
      })
      .catch(() => {});
    api<{ ccPhone: string | null }>('/api/drivers/config')
      .then((d) => setCcPhone(d.ccPhone))
      .catch(() => {});

    const merge = (fetched: CCMessage[]) => {
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const added = fetched.filter((m) => !ids.has(m.id));
        if (!added.length) return prev;
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
        return [...prev, ...added];
      });
    };

    const pollId = setInterval(() => {
      api<{ messages: CCMessage[] }>('/api/drivers/cc-chat')
        .then((d) => merge(d.messages ?? []))
        .catch(() => {});
    }, 5000);

    const onMsg = (msg: CCMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
        return [...prev, msg];
      });
    };
    socketService.on('cc_message', onMsg);
    return () => {
      socketService.off('cc_message', onMsg);
      clearInterval(pollId);
    };
  }, []);

  const scrollBottom = () =>
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);

  const sendMsg = async (content: string, type = 'text') => {
    if (!content.trim()) return;
    setSending(true);
    try {
      const { message } = await api<{ message: CCMessage }>('/api/drivers/cc-chat', {
        method: 'POST', body: { content: content.trim(), type },
      });
      setMessages((prev) => [...prev, message]);
      scrollBottom();
    } catch {} finally { setSending(false); }
  };

  const sendText = () => {
    const t = input.trim(); if (!t) return;
    setInput('');
    sendMsg(t, 'text');
  };

  const toggleRecording = async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) return;
      setSending(true);
      try {
        const fd = new FormData();
        fd.append('file', { uri, type: 'audio/mp4', name: 'voice.m4a' } as any);
        const { url } = await uploadFile('/api/upload', fd);
        await sendMsg(url, 'audio');
      } catch {} finally { setSending(false); }
      return;
    }
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', 'Activez le microphone.'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', 'Activez la galerie.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext  = asset.uri.split('.').pop() ?? 'jpg';
    const mime = asset.mimeType ?? `image/${ext}`;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, type: mime, name: `img.${ext}` } as any);
      const { url } = await uploadFile('/api/upload', fd);
      await sendMsg(url, 'image');
    } catch { Alert.alert('Erreur', 'Impossible d\'envoyer l\'image.'); }
    finally { setSending(false); }
  };

  const callCC = () => {
    if (!ccPhone) { Alert.alert('Indisponible', 'Le numéro du Call Center n\'est pas configuré.'); return; }
    Linking.openURL(`tel:${ccPhone}`);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={styles.headerBrand}>Centre d'appels</Text>
        <TouchableOpacity
          style={adminChat.callBtn}
          onPress={callCC}
          activeOpacity={0.75}
        >
          <Icon name="phone" size={18} color="#fff" strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={[styles.empty, { flex: 1 }]}>
          <Icon name="headset" size={52} color={TEXT2} strokeWidth={1.5} />
          <Text style={styles.emptyText}>Aucun message</Text>
          <Text style={styles.emptyHint}>Le call center peut vous contacter ici</Text>
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={adminChat.list}
          onContentSizeChange={scrollBottom}
          renderItem={({ item }) => <CCBubble message={item} />}
        />
      )}

      {/* Barre de saisie */}
      <View style={adminChat.inputBar}>
        {/* Image */}
        <TouchableOpacity style={adminChat.iconBtn} onPress={pickImage} disabled={sending || !!recording}>
          <Icon name="image" size={20} color={TEXT2} strokeWidth={1.75} />
        </TouchableOpacity>
        {/* TextInput */}
        <TextInput
          style={adminChat.input}
          value={input}
          onChangeText={setInput}
          placeholder={recording ? '🔴 Enregistrement...' : 'Répondre au centre d\'appels…'}
          placeholderTextColor={recording ? '#FF3B30' : TEXT2}
          returnKeyType="send"
          onSubmitEditing={sendText}
          editable={!recording}
          multiline
          maxLength={1000}
        />
        {/* Mic ou Send */}
        {input.trim() ? (
          <TouchableOpacity
            style={[adminChat.actionBtn, sending && { opacity: 0.5 }]}
            onPress={sendText}
            disabled={sending}
            activeOpacity={0.75}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[adminChat.actionBtn, recording && adminChat.actionBtnRec]}
            onPress={toggleRecording}
            disabled={sending && !recording}
            activeOpacity={0.75}
          >
            {recording
              ? <Icon name="pause" size={18} color="#fff" strokeWidth={2} />
              : <Icon name="mic" size={20} color="#fff" strokeWidth={1.75} />}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const WAVE_HEIGHTS = [6, 10, 15, 20, 12, 18, 8, 14, 20, 10, 15, 6];

function CCBubble({ message }: { message: CCMessage }) {
  const isAdmin = message.senderRole === 'admin';
  const time = new Date(message.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const togglePlay = async () => {
    if (!message.content) return;
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: message.content },
          { shouldPlay: true }
        );
        soundRef.current = sound;
        if (status.isLoaded && status.durationMillis) {
          setDuration(Math.round(status.durationMillis / 1000));
        }
        sound.setOnPlaybackStatusUpdate((s) => {
          if (s.isLoaded) {
            if (s.durationMillis) setDuration(Math.round(s.durationMillis / 1000));
            if (s.didJustFinish) setPlaying(false);
          }
        });
        setPlaying(true);
      } else if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch {}
  };

  const durStr = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  let content: React.ReactNode;
  if (message.type === 'image') {
    content = (
      <Image
        source={{ uri: message.content }}
        style={adminChat.msgImage}
        resizeMode="cover"
      />
    );
  } else if (message.type === 'audio') {
    content = (
      <View style={adminChat.audioRow}>
        <TouchableOpacity
          style={[adminChat.audioPlayBtn, { backgroundColor: isAdmin ? TEXT : 'rgba(255,255,255,0.25)' }]}
          onPress={togglePlay}
          activeOpacity={0.75}
        >
          <Icon name={playing ? 'pause' : 'play'} size={13} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={adminChat.audioWaveArea}>
          {WAVE_HEIGHTS.map((h, i) => (
            <View
              key={i}
              style={[
                adminChat.audioWaveBar,
                { height: h },
                { backgroundColor: isAdmin
                    ? (playing ? PRIMARY : TEXT2)
                    : (playing ? '#fff' : 'rgba(255,255,255,0.55)') },
              ]}
            />
          ))}
        </View>
        <Text style={[adminChat.audioDur, { color: isAdmin ? TEXT2 : 'rgba(255,255,255,0.7)' }]}>
          {duration !== null ? durStr(duration) : '0:00'}
        </Text>
      </View>
    );
  } else {
    content = <Text style={isAdmin ? adminChat.textIn : adminChat.textOut}>{message.content}</Text>;
  }

  return (
    <View style={[adminChat.row, isAdmin ? adminChat.rowIn : adminChat.rowOut]}>
      {isAdmin && (
        <View style={adminChat.avatar}>
          <Text style={adminChat.avatarText}>CC</Text>
        </View>
      )}
      <View style={[adminChat.bubble, isAdmin ? adminChat.bubbleIn : adminChat.bubbleOut]}>
        {content}
        <Text style={adminChat.time}>{time}</Text>
      </View>
    </View>
  );
}

const adminChat = StyleSheet.create({
  list: { padding: 14, paddingBottom: 8, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowIn: { justifyContent: 'flex-start' },
  rowOut: { justifyContent: 'flex-end' },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  avatarText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  bubble: { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleIn: { backgroundColor: CARD, borderBottomLeftRadius: 4 },
  bubbleOut: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  textIn:  { color: TEXT, fontSize: 15, lineHeight: 20 },
  textOut: { color: '#fff', fontSize: 15, lineHeight: 20 },
  time: { fontSize: 11, color: 'rgba(128,128,128,0.7)', alignSelf: 'flex-end' },
  msgImage: { width: 200, height: 150, borderRadius: 10 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, minWidth: 160 },
  audioPlayBtn: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  audioWaveArea: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4,
  },
  audioWaveBar: { width: 3, borderRadius: 2, flexShrink: 0 },
  audioDur: { fontSize: 12, fontWeight: '500' as const, flexShrink: 0 },
  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: BORDER, backgroundColor: CARD,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: SURFACE, justifyContent: 'center', alignItems: 'center',
  },
  input: {
    flex: 1, backgroundColor: '#F0F0F5', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: TEXT, maxHeight: 100,
  },
  actionBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
  },
  actionBtnRec: { backgroundColor: '#FF3B30' },
  // Call button in header
  callBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
});

// ─── Onglet Profil — avec sous-pages ─────────────────────────────────────────

type ProfileView = 'main' | 'info' | 'wallet' | 'history';

function ProfilTab() {
  const [view, setView] = useState<ProfileView>('main');
  if (view === 'info')    return <PersonalInfoView    onBack={() => setView('main')} />;
  if (view === 'wallet')  return <WalletView          onBack={() => setView('main')} />;
  if (view === 'history') return <HistoryView         onBack={() => setView('main')} />;
  return <ProfileMainView onNavigate={setView} />;
}

// ── Page principale Profil ────────────────────────────────────────────────────
function ProfileMainView({ onNavigate }: { onNavigate: (v: ProfileView) => void }) {
  const { driver, phone, logout } = useAuthStore();
  const initial = driver?.name?.charAt(0).toUpperCase() ?? '?';

  const handleLogout = () =>
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: logout },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header sombre */}
      <View style={styles.header}>
        <Text style={styles.headerBrand}>Mon compte</Text>
      </View>

      {/* Avatar + nom + rating */}
      <View style={styles.profileHero}>
        <View style={styles.profileAvatarWrap}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initial}</Text>
          </View>
          <View style={styles.profileAvatarBadge}>
            <Text style={{ fontSize: 10, color: '#fff' }}>★</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{driver?.name ?? '—'}</Text>
          <Text style={styles.profileRating}>★ 4.8 · 248 courses</Text>
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>Compte vérifié</Text>
          </View>
        </View>
      </View>

      {/* Wallet card */}
      <TouchableOpacity style={styles.walletCard} onPress={() => onNavigate('wallet')} activeOpacity={0.85}>
        <View style={{ flex: 1 }}>
          <Text style={styles.walletLabel}>Solde disponible</Text>
          <Text style={styles.walletAmount}>1 250 MRU</Text>
        </View>
        <View style={styles.walletArrow}>
          <Icon name="chevron-right" size={20} color="#fff" strokeWidth={2} />
        </View>
      </TouchableOpacity>

      {/* Menu */}
      <View style={styles.menuCard}>
        <PMenuItem
          iconName="user" iconBg="#EBF5FF" iconColor="#1565C0"
          label="Informations personnelles" sub="Nom, téléphone"
          onPress={() => onNavigate('info')}
        />
        <PMenuItem
          iconName="wallet" iconBg="#FFF3E0" iconColor="#E65100"
          label="Wallet & Transactions" sub="Recharge, historique"
          onPress={() => onNavigate('wallet')}
        />
        <PMenuItem
          iconName="history" iconBg="#F0F0F0" iconColor="#555"
          label="Historique des courses" sub="Courses passées, revenus"
          onPress={() => onNavigate('history')}
        />
        <PMenuItem
          iconName="bell" iconBg="#F0F0F0" iconColor="#555"
          label="Notifications" sub="Activées"
          last onPress={() => {}}
        />
      </View>

      {/* Déconnexion */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.75}>
        <Icon name="logout" size={18} color="#e53935" />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function PMenuItem({
  iconName, iconBg, iconColor = '#555', label, sub, last, onPress,
}: {
  iconName: any; iconBg: string; iconColor?: string; label: string; sub: string; last?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={20} color={iconColor} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuSub}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={TEXT2} strokeWidth={1.5} />
    </TouchableOpacity>
  );
}

// ── Sous-page: Informations personnelles ──────────────────────────────────────
function PersonalInfoView({ onBack }: { onBack: () => void }) {
  const { driver, phone } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const initial = driver?.name?.charAt(0).toUpperCase() ?? '?';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.subBackBtn}>
          <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Informations personnelles</Text>
      </View>

      {/* Avatar + nom */}
      <View style={styles.subProfileRow}>
        <View style={styles.subAvatar}>
          <Text style={styles.subAvatarText}>{initial}</Text>
        </View>
        <View>
          <Text style={styles.subProfileName}>{driver?.name ?? '—'}</Text>
          <Text style={styles.subProfilePhone}>{phone ?? '—'}</Text>
        </View>
      </View>

      {/* MES INFORMATIONS */}
      <View style={styles.infoCard}>
        <Text style={styles.sectionLabel}>MES INFORMATIONS</Text>
        <InfoRow label="Nom"      value={driver?.name ?? '—'} />
        <InfoRow label="Téléphone" value={phone ?? '—'} last />
        <TouchableOpacity style={styles.editBtn} activeOpacity={0.7}>
          <Icon name="edit" size={16} color={TEXT2} strokeWidth={1.75} />
          <Text style={styles.editBtnText}>Modifier</Text>
        </TouchableOpacity>
      </View>

      {/* STATISTIQUES */}
      <View style={styles.infoCard}>
        <Text style={styles.sectionLabel}>STATISTIQUES</Text>
        <InfoRow label="Membre depuis" value="Janvier 2025" colored />
        <InfoRow label="Total courses"  value="248" />
        <InfoRow label="Note moyenne"   value="★ 4.8" last colored />
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value, last, colored }: { label: string; value: string; last?: boolean; colored?: boolean }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoKey}>{label}</Text>
      <Text style={[styles.infoVal, colored && { color: '#E85D04' }]}>{value}</Text>
    </View>
  );
}

// ── Sous-page: Wallet ─────────────────────────────────────────────────────────
function WalletView({ onBack }: { onBack: () => void }) {
  const [provider, setProvider] = useState<'bankily' | 'sedad'>('bankily');
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<{ balance: number; transactions: any[] }>('/api/wallet')
      .then((d) => { setBalance(d.balance); setTransactions(d.transactions); })
      .catch(() => {});
  }, []);

  const handleRecharge = async () => {
    const amt = parseInt(amount);
    if (!amt || amt < 100) { Alert.alert('Erreur', 'Montant minimum : 100 MRU'); return; }
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/api/wallet/recharge', {
        method: 'POST', body: { amount: amt, provider },
      });
      Alert.alert('Demande envoyée', res.message);
      setAmount('');
    } catch {
      Alert.alert('Erreur', 'Impossible d\'envoyer la demande.');
    } finally {
      setSubmitting(false);
    }
  };

  const txIcon = (type: string) =>
    type === 'recharge' ? { iconName: 'arrow-up-right', color: '#1a7a35', bg: 'rgba(52,199,89,.12)' }
    : type === 'commission' ? { iconName: 'arrow-down-left', color: '#b86800', bg: 'rgba(255,149,0,.12)' }
    : { iconName: 'arrow-up-right', color: '#1a7a35', bg: 'rgba(52,199,89,.12)' };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.subBackBtn}>
          <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Mon Wallet</Text>
      </View>

      <View style={styles.walletHeroFull}>
        <Text style={styles.walletHeroLabel}>Solde disponible</Text>
        <Text style={styles.walletHeroAmount}>
          {balance !== null ? `${balance.toFixed(0)} MRU` : '— MRU'}
        </Text>
        <Text style={styles.walletHeroSub}>Minimum requis : 200 MRU</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Recharger le wallet</Text>
        <Text style={styles.rechargeInfo}>
          Payez via Bankily ou Sedad avec le code marchand VECTO, puis soumettez votre demande.
        </Text>
        <Text style={styles.fieldLabel}>Fournisseur</Text>
        <View style={styles.providerRow}>
          {(['bankily', 'sedad'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.providerBtn, provider === p && styles.providerBtnActive]}
              onPress={() => setProvider(p)}
            >
              <Text style={[styles.providerBtnText, provider === p && styles.providerBtnTextActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Montant (MRU)</Text>
        <TextInput
          style={[styles.fieldBox, { color: TEXT }]}
          placeholder="Ex: 500" placeholderTextColor={TEXT2}
          keyboardType="numeric" value={amount} onChangeText={setAmount}
        />
        <TouchableOpacity
          style={[styles.validateBtn, submitting && { opacity: 0.5 }]}
          onPress={handleRecharge} disabled={submitting} activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.validateBtnText}>Valider le rechargement</Text>
          }
        </TouchableOpacity>
      </View>

      {transactions.length > 0 && (
        <>
          <Text style={styles.histSectionTitle}>Historique</Text>
          <View style={styles.infoCard}>
            {transactions.map((tx, i) => {
              const { icon, color, bg } = txIcon(tx.type);
              const isPos = tx.amount > 0;
              const date = new Date(tx.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
              return (
                <HistItem
                  key={tx.id}
                  iconName={iconName} iconColor={color} iconBg={bg}
                  label={tx.description ?? tx.type}
                  date={date}
                  amount={`${isPos ? '+' : '-'} ${Math.abs(tx.amount).toFixed(0)} MRU`}
                  amountColor={isPos ? '#1a7a35' : '#b86800'}
                  last={i === transactions.length - 1}
                />
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function HistItem({ iconName, iconColor, iconBg, label, date, amount, amountColor, last }:
  { iconName: any; iconColor: string; iconBg: string; label: string; date: string; amount: string; amountColor: string; last?: boolean }) {
  return (
    <View style={[styles.histRow, last && { borderBottomWidth: 0 }]}>
      <View style={[styles.histIcon, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={18} color={iconColor} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.histLabel}>{label}</Text>
        <Text style={styles.histDate}>{date}</Text>
      </View>
      <Text style={[styles.histAmount, { color: amountColor }]}>{amount}</Text>
    </View>
  );
}

// ── Sous-page: Historique des courses ─────────────────────────────────────────
function HistoryView({ onBack }: { onBack: () => void }) {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ deliveries: any[] }>('/api/deliveries/history')
      .then((d) => setCourses(d.deliveries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.subBackBtn}>
          <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Historique</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={PRIMARY} style={{ marginTop: 40 }} />
      ) : courses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>Aucune course terminée</Text>
        </View>
      ) : (
        <View style={[styles.infoCard, { gap: 0 }]}>
          {courses.map((c, i) => {
            const isDone = c.status === 'done';
            const statusLabel = isDone ? 'Livrée' : 'Annulée';
            const statusColor = isDone ? '#1a7a35' : '#c0392b';
            const date = new Date(c.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            return (
              <View key={c.id} style={[styles.histCourseRow, i === courses.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.histCourseIcon}>
                  <Text style={{ color: '#fff', fontSize: 16 }}>🛵</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histCourseLabel}>{c.clientAlias ?? `Course`}</Text>
                  <Text style={styles.histCourseDate}>{date}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.histCourseBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.histCourseBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Bottom Tab Bar ──────────────────────────────────────────────────────────

function BottomTabBar({
  active, onSelect, adminUnread,
}: { active: Tab; onSelect: (t: Tab) => void; adminUnread: number }) {
  const tabs: { key: Tab; icon: 'scooter' | 'chat' | 'headset' | 'person' }[] = [
    { key: 'courses', icon: 'scooter' },
    { key: 'chats',   icon: 'chat' },
    { key: 'admin',   icon: 'headset' },
    { key: 'profil',  icon: 'person' },
  ];

  return (
    <View style={styles.tabBarWrap}>
      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const isActive = active === t.key;
          const showBadge = t.key === 'admin' && adminUnread > 0;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => onSelect(t.key)}
              activeOpacity={0.7}
            >
              <View style={{ position: 'relative' }}>
                <Icon
                  name={t.icon}
                  size={22}
                  color={isActive ? '#fff' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {showBadge && (
                  <View style={tabBadgeStyle.dot}>
                    <Text style={tabBadgeStyle.text}>{adminUnread > 9 ? '9+' : adminUnread}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const tabBadgeStyle = StyleSheet.create({
  dot: {
    position: 'absolute', top: -5, right: -7,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3,
  },
  text: { color: '#fff', fontSize: 9, fontWeight: '800' },
});

// ─── FCM ────────────────────────────────────────────────────────────────────

async function registerFCMToken() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const tokenData = await Notifications.getDevicePushTokenAsync();
    await api('/api/drivers/fcm-token', { method: 'PUT', body: { token: tokenData.data } });
  } catch {}
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingBottom: 84 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBrand: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  dispoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dispoLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },

  // Section header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  sectionCount: { fontSize: 13, color: TEXT2 },

  // List
  list: { paddingBottom: 20 },
  empty: { alignItems: 'center', marginTop: 80, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: TEXT, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: TEXT2, fontSize: 13 },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Active courses
  activeSection: { marginBottom: 12 },
  activeSectionTitle: {
    color: PRIMARY, fontSize: 13, fontWeight: '700',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  activeCourseCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#4caf50',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  activeCourseLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50' },
  activeCourseAlias: { color: TEXT, fontWeight: '700', fontSize: 14 },
  activeCourseArrow: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  availableSectionTitle: {
    color: TEXT2, fontSize: 13, fontWeight: '700',
    marginTop: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Modal nouvelle course
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, gap: 12,
  },
  modalTitle: { color: PRIMARY, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  modalAlias: { color: TEXT, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  modalMsg: { color: TEXT2, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  playBtn: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  playBtnText: { color: PRIMARY, fontSize: 15, fontWeight: '600' },
  modalPriceBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 8, alignSelf: 'center',
  },
  modalPriceText: { color: '#1a7a35', fontSize: 22, fontWeight: '800' },
  modalRoute: {
    backgroundColor: '#F5F5F7', borderRadius: 12, padding: 12, gap: 8,
  },
  modalRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  modalRouteText: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '500' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  dismissBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: SURFACE, alignItems: 'center',
  },
  dismissBtnText: { color: TEXT2, fontSize: 15, fontWeight: '600' },
  acceptModalBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: PRIMARY, alignItems: 'center',
  },
  acceptModalBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnOff: { opacity: 0.5 },

  // Chat list
  activeCountBadge: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500' },
  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD, paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  chatAvatarWrap: { position: 'relative' },
  chatAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
  },
  chatAvatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#34C759', borderWidth: 2, borderColor: CARD,
  },
  chatAlias: { fontSize: 16, fontWeight: '700', color: TEXT },
  chatLastMsg: { fontSize: 13, color: TEXT2 },
  chatTime: { fontSize: 12, color: TEXT2, flexShrink: 0 },
  chatArrow: { fontSize: 22, color: TEXT2 },

  // Profile main
  profileHero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 20, backgroundColor: CARD,
    borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  profileAvatarWrap: { position: 'relative' },
  profileAvatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#C7E0F4', justifyContent: 'center', alignItems: 'center',
  },
  profileAvatarText: { fontSize: 24, fontWeight: '800', color: '#1565C0' },
  profileAvatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: CARD,
  },
  profileName: { fontSize: 20, fontWeight: '800', color: TEXT },
  profileRating: { fontSize: 13, color: TEXT2, marginTop: 2 },
  verifiedBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 3,
    alignSelf: 'flex-start', marginTop: 4,
  },
  verifiedText: { fontSize: 12, color: '#2e7d32', fontWeight: '600' },

  // Wallet card on profile
  walletCard: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, borderRadius: 18, padding: 20,
    backgroundColor: PRIMARY,
  },
  walletLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  walletAmount: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 },
  walletArrow: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },

  // Menu card
  menuCard: {
    backgroundColor: CARD, marginHorizontal: 16, borderRadius: 16,
    overflow: 'hidden', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  menuIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  menuIconEmoji: { fontSize: 18 },
  menuLabel: { fontSize: 15, fontWeight: '600', color: TEXT },
  menuSub: { fontSize: 12, color: TEXT2, marginTop: 1 },
  menuChevron: { fontSize: 22, color: TEXT2 },

  // Logout
  logoutBtn: {
    marginHorizontal: 16, borderRadius: 14,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFF1F0', borderWidth: 0.5, borderColor: 'rgba(255,59,48,.2)',
  },
  logoutIcon: { color: '#e53935', fontSize: 18 },
  logoutText: { color: '#e53935', fontSize: 15, fontWeight: '600' },

  // Sub-screen header
  subHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 52, paddingBottom: 14, paddingHorizontal: 16,
    backgroundColor: BG,
  },
  subBackBtn: { padding: 4 },
  subBackIcon: { fontSize: 22, color: TEXT },
  subTitle: { fontSize: 17, fontWeight: '700', color: TEXT },

  // Personal info
  subProfileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 20, backgroundColor: CARD,
    borderBottomWidth: 0.5, borderBottomColor: BORDER, marginBottom: 12,
  },
  subAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#C7E0F4', justifyContent: 'center', alignItems: 'center',
  },
  subAvatarText: { fontSize: 22, fontWeight: '800', color: '#1565C0' },
  subProfileName: { fontSize: 18, fontWeight: '800', color: TEXT },
  subProfilePhone: { fontSize: 13, color: TEXT2, marginTop: 2 },

  // Info card
  infoCard: {
    backgroundColor: CARD, marginHorizontal: 16, borderRadius: 16,
    padding: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1, gap: 0,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: TEXT2,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  infoKey: { fontSize: 15, color: TEXT, fontWeight: '500' },
  infoVal: { fontSize: 15, color: TEXT2 },
  editBtn: {
    marginTop: 14, paddingVertical: 11, borderRadius: 10,
    backgroundColor: BG, borderWidth: 0.5, borderColor: BORDER,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  editBtnText: { fontSize: 14, fontWeight: '600', color: TEXT },

  // Wallet sub-page
  walletHeroFull: {
    backgroundColor: PRIMARY, margin: 16, borderRadius: 18, padding: 24,
  },
  walletHeroLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  walletHeroAmount: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  walletHeroSub: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 10 },
  rechargeInfo: {
    fontSize: 13, color: TEXT2, lineHeight: 20,
    backgroundColor: BG, borderRadius: 10, padding: 12, marginBottom: 14,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: TEXT2, marginBottom: 8, marginTop: 10 },
  fieldBox: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    backgroundColor: CARD, paddingVertical: 14, paddingHorizontal: 14,
  },
  fieldPlaceholder: { color: TEXT2, fontSize: 15 },
  providerRow: { flexDirection: 'row', gap: 8 },
  providerBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: BORDER, alignItems: 'center',
  },
  providerBtnActive: { borderColor: PRIMARY, backgroundColor: BG },
  providerBtnText: { fontSize: 14, fontWeight: '600', color: TEXT2 },
  providerBtnTextActive: { color: TEXT },
  otpRow: { flexDirection: 'row', gap: 12, marginVertical: 4 },
  otpDot: {
    width: 56, height: 58, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  otpDotText: { fontSize: 28, color: TEXT2 },
  validateBtn: {
    backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  validateBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  histSectionTitle: { fontSize: 17, fontWeight: '700', color: TEXT, marginHorizontal: 16, marginBottom: 8, marginTop: 4 },
  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  histIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  histLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  histDate: { fontSize: 12, color: TEXT2, marginTop: 1 },
  histAmount: { fontSize: 14, fontWeight: '700' },

  // History courses
  histCourseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  histCourseIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
  },
  histCourseLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  histCourseDate: { fontSize: 12, color: TEXT2, marginTop: 1 },
  histCourseAmount: { fontSize: 14, fontWeight: '700' },
  histCourseBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  histCourseBadgeText: { fontSize: 11, fontWeight: '600' },

  // Tab bar — dark pill
  tabBarWrap: {
    position: 'absolute', bottom: 20, left: 24, right: 24,
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(18,18,18,0.96)',
    borderRadius: 100,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  tabItem: {
    flex: 1, height: 44, borderRadius: 100,
    justifyContent: 'center', alignItems: 'center',
  },
  tabItemActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
});
