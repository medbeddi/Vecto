import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
import { BANKILY_URI, SEDAD_URI, MASRIVI_URI } from '../assets/logos';
import * as Clipboard from 'expo-clipboard';
import type { Delivery, Message, CCMessage, RootStackParamList } from '../types';

type Tab = 'courses' | 'historique' | 'chats' | 'admin' | 'profil';
type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

type IncomingOrder = {
  deliveryId: string;
  clientAlias: string;
  createdAt: string;
  broadcastAt?: string | null;
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
  const navigation = useNavigation<Nav>();
  const [activeTab, setActiveTab] = useState<Tab>('courses');
  const [adminUnread, setAdminUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const { pendingCancellation, setPendingCancellation } = useDeliveriesStore();

  useEffect(() => {
    // Notification message call center
    const onCCMsg = (msg: CCMessage) => {
      setActiveTab((t) => {
        if (t !== 'admin') {
          setAdminUnread((n) => n + 1);
          Notifications.scheduleNotificationAsync({
            content: {
              title: '📞 Centre d\'appels',
              body: msg.type === 'audio' ? 'Message vocal du call center'
                   : msg.type === 'image' ? 'Photo du call center'
                   : (msg.content ?? 'Nouveau message'),
              data: { type: 'cc_message' },
            },
            trigger: null,
          });
        }
        return t;
      });
    };

    // Notification message client (si pas dans ChatScreen)
    const onClientMsg = (msg: Message) => {
      const { activeDelivery, activeCourses } = useDeliveriesStore.getState();
      if (activeDelivery) return; // déjà dans le chat, pas besoin de notifier
      const delivery = activeCourses[0];
      if (!delivery) return;
      setChatUnread((n) => n + 1);
      Notifications.scheduleNotificationAsync({
        content: {
          title: `💬 ${delivery.clientAlias}`,
          body: msg.type === 'audio' ? 'Message vocal'
               : msg.type === 'image' ? 'Photo'
               : msg.type === 'location' ? 'Position partagée'
               : (msg.content ?? 'Nouveau message'),
          data: { type: 'client_message', deliveryId: delivery.id },
        },
        trigger: null,
      });
    };

    // Navigation depuis tap notification
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'client_message') {
        const { activeCourses } = useDeliveriesStore.getState();
        const delivery = activeCourses.find((d) => d.id === data.deliveryId) ?? activeCourses[0];
        if (delivery) {
          setChatUnread(0);
          navigation.navigate('Chat', { delivery });
        }
      } else if (data?.type === 'cc_message') {
        setActiveTab('admin');
        setAdminUnread(0);
      } else if (data?.deliveryId) {
        setActiveTab('courses');
      }
    });

    socketService.on('cc_message', onCCMsg as any);
    socketService.on('client_message', onClientMsg);
    return () => {
      socketService.off('cc_message', onCCMsg as any);
      socketService.off('client_message', onClientMsg);
      notifSub.remove();
    };
  }, [navigation]);

  const handleTabSelect = (t: Tab) => {
    setActiveTab(t);
    if (t === 'admin') setAdminUnread(0);
    if (t === 'chats') setChatUnread(0);
  };

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {activeTab === 'courses'    && <CoursesTab />}
        {activeTab === 'historique' && <HistoriqueTab />}
        {activeTab === 'chats'      && <ChatsTab />}
        {activeTab === 'admin'      && <AdminChatTab />}
        {activeTab === 'profil'     && <ProfilTab />}
      </View>
      <BottomTabBar active={activeTab} onSelect={handleTabSelect} adminUnread={adminUnread} chatUnread={chatUnread} />
    {pendingCancellation && (
      <CancellationReasonModal
        clientAlias={pendingCancellation.clientAlias}
        onSent={() => setPendingCancellation(null)}
      />
    )}
    </View>
  );
}

// ─── Onglet Courses ───────────────────────────────────────────────────────────

function CoursesTab() {
  const navigation = useNavigation<Nav>();
  const { driver } = useAuthStore();
  const {
    available, loadingDeliveries, loadAvailable, silentRefreshAvailable, loadActiveCourses,
    upsertAvailable, removeAvailable, activeCourses, addActiveCourse,
  } = useDeliveriesStore();

  const [accepting, setAccepting] = useState<string | null>(null);
  const [dispo, setDispo] = useState(true);
  const [togglingDispo, setTogglingDispo] = useState(false);
  const [incomingOrder, setIncomingOrder] = useState<IncomingOrder | null>(null);
  const [modalCountdown, setModalCountdown] = useState(60);
  const soundRef = useRef<Audio.Sound | null>(null);
  const socketDeliveryIds = useRef<Set<string>>(new Set());
  const modalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const joinActiveRooms = () =>
      useDeliveriesStore.getState().activeCourses.forEach((d) => socketService.joinRoom(d.id));

    loadAvailable();
    loadActiveCourses().then(joinActiveRooms);
    registerFCMToken();
    startLocationTracking();

    // Re-poll après reconnexion + re-join les rooms des livraisons actives
    const onReconnect = () => {
      loadAvailable();
      loadActiveCourses().then(joinActiveRooms);
    };
    socketService.on('connect', onReconnect);

    // Rechargement immédiat quand l'app revient au premier plan
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        loadAvailable();
        loadActiveCourses();
        if (!socketService.connected) socketService.connect().catch(() => {});
      }
    });

    // Rechargement périodique — toujours actif (filet de sécurité si socket rate un événement)
    let _pollTick = 0;
    const pollInterval = setInterval(() => {
      silentRefreshAvailable();
      _pollTick++;
      if (_pollTick % 3 === 0) loadActiveCourses(); // toutes les 15s
    }, 5000);

    const onNewOrder = (order: IncomingOrder) => {
      socketDeliveryIds.current.add(order.deliveryId);

      // Check if the order is already visible in the list (rebroadcast of existing card)
      const alreadyVisible = useDeliveriesStore.getState().available.some(
        (d) => d.id === order.deliveryId
      );

      // Only open modal + play audio + send notification for genuinely new orders
      if (!alreadyVisible) {
        setIncomingOrder(order);

        // Compte à rebours modal (60s)
        if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
        if (modalCountdownRef.current) clearInterval(modalCountdownRef.current);
        setModalCountdown(60);
        modalCountdownRef.current = setInterval(() => {
          setModalCountdown((prev) => {
            if (prev <= 1) { clearInterval(modalCountdownRef.current!); return 0; }
            return prev - 1;
          });
        }, 1000);
        modalTimerRef.current = setTimeout(() => {
          setIncomingOrder((prev) => prev?.deliveryId === order.deliveryId ? null : prev);
          modalTimerRef.current = null;
        }, 60 * 1000);

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
      }

      // Always update the card (resets countdown on rebroadcast)
      upsertAvailable({
        id: order.deliveryId,
        clientAlias: order.clientAlias,
        createdAt: order.createdAt,
        broadcastAt: order.broadcastAt,
        status: 'pending',
        description: order.message.content ?? '',
        initialMediaType: order.message.type,
        initialMediaUrl: order.message.type === 'audio' ? order.message.content : null,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        price: order.price,
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
      socketService.off('connect', onReconnect);
      socketService.off('new_order', onNewOrder);
      socketService.off('order_taken', onOrderTaken);
      clearInterval(pollInterval);
      appStateSubscription.remove();
      if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
      if (modalCountdownRef.current) clearInterval(modalCountdownRef.current);
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
    if (modalCountdownRef.current) { clearInterval(modalCountdownRef.current); modalCountdownRef.current = null; }
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.modalTitle}>🛵 Nouvelle course</Text>
              <View style={[styles.modalCountdown, modalCountdown <= 15 && styles.modalCountdownRed]}>
                <Text style={styles.modalCountdownText}>{modalCountdown}s</Text>
              </View>
            </View>
            <Text style={styles.modalAlias}>{incomingOrder?.clientAlias}</Text>

            {incomingOrder?.price != null && (
              <View style={styles.modalPriceBadge}>
                <Text style={styles.modalPriceText}>{(() => { const p = Number(incomingOrder.price); return Number.isInteger(p) ? p : p.toFixed(2); })()} MRU</Text>
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
                    <View style={styles.activeCourseHeader}>
                      <View style={styles.activeCourseLeft}>
                        <View style={styles.activeDot} />
                        <Text style={styles.activeCourseAlias}>{d.clientAlias}</Text>
                      </View>
                      <Text style={styles.activeCourseArrow}>→ Ouvrir</Text>
                    </View>
                    <CourseProgressBar status={d.status} />
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
              removeAvailable(d.id);
              api(`/api/deliveries/${d.id}/refuse`, { method: 'POST' }).catch(() => {});
            }}
            onExpire={(d) => {
              socketDeliveryIds.current.delete(d.id);
              removeAvailable(d.id);
            }}
            accepting={accepting === item.id}
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
        const prevById = new Map(prev.map((m) => [m.id, m]));
        let changed = false;
        for (const m of fetched) {
          const ex = prevById.get(m.id);
          // Ajouter les nouveaux messages, ou remplacer les messages cassés (content/date manquants)
          if (!ex || !ex.content || !ex.createdAt) {
            prevById.set(m.id, m);
            changed = true;
          }
        }
        if (!changed) return prev;
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
        return Array.from(prevById.values());
      });
    };

    const pollId = setInterval(() => {
      api<{ messages: CCMessage[] }>('/api/drivers/cc-chat')
        .then((d) => merge(d.messages ?? []))
        .catch(() => {});
    }, 2000);

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
    const tempId = `tmp_${Date.now()}`;
    const tempMsg: CCMessage = { id: tempId, senderRole: 'driver', type, content: content.trim(), createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    scrollBottom();
    try {
      const { message } = await api<{ message: CCMessage }>('/api/drivers/cc-chat', {
        method: 'POST', body: { content: content.trim(), type },
      });
      setMessages((prev) => prev.map((m) => m.id === tempId ? message : m));
      scrollBottom();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally { setSending(false); }
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
    // 'limited' = iOS 14 accès partiel, on autorise quand même
    if (status === 'denied') { Alert.alert('Permission refusée', 'Activez la galerie dans les paramètres.'); return; }
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
    // Enregistrer l'appel dans le chat
    api<{ message: CCMessage }>('/api/drivers/cc-chat', {
      method: 'POST', body: { content: 'Appel vers le centre d\'appels', type: 'call' },
    }).then(({ message }) => {
      setMessages((prev) => [...prev, message]);
    }).catch(() => {});
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
  const _d = new Date(message.createdAt);
  const time = isNaN(_d.getTime()) ? '--:--' : _d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [imgError, setImgError] = useState(false);
  const [imgFullscreen, setImgFullscreen] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const togglePlay = async () => {
    if (!message.content) return;
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
        });
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: message.content },
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          (s) => {
            if (s.isLoaded) {
              if (s.durationMillis) setDuration(Math.round(s.durationMillis / 1000));
              if (s.didJustFinish) setPlaying(false);
            }
          }
        );
        soundRef.current = sound;
        if (status.isLoaded && status.durationMillis) {
          setDuration(Math.round(status.durationMillis / 1000));
        }
        setPlaying(true);
      } else if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch {}
  };

  const durStr = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (message.type === 'call') {
    return (
      <View style={adminChat.systemRow}>
        <Text style={adminChat.systemText}>📞 {message.content || 'Appel'} · {time}</Text>
      </View>
    );
  }

  let content: React.ReactNode;
  if (message.type === 'image') {
    content = imgError ? (
      <Text style={adminChat.imgError}>Image non disponible</Text>
    ) : (
      <>
        <TouchableOpacity onPress={() => setImgFullscreen(true)} activeOpacity={0.88}>
          <Image
            source={{ uri: message.content }}
            style={adminChat.msgImage}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        </TouchableOpacity>
        <Modal visible={imgFullscreen} transparent={false} animationType="fade" onRequestClose={() => setImgFullscreen(false)} statusBarTranslucent>
          <View style={adminChat.imgViewer}>
            <TouchableOpacity style={adminChat.imgViewerClose} onPress={() => setImgFullscreen(false)} activeOpacity={0.75}>
              <Icon name="x" size={22} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
            <Image source={{ uri: message.content }} style={adminChat.imgViewerImg} resizeMode="contain" />
          </View>
        </Modal>
      </>
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
  bubbleOut: { backgroundColor: BRAND, borderBottomRightRadius: 4 },
  textIn:  { color: TEXT, fontSize: 15, lineHeight: 20 },
  textOut: { color: '#fff', fontSize: 15, lineHeight: 20 },
  time: { fontSize: 11, color: 'rgba(128,128,128,0.7)', alignSelf: 'flex-end' },
  msgImage: { width: 200, height: 150, borderRadius: 10 },
  imgError: { color: TEXT2, fontSize: 13, opacity: 0.6, fontStyle: 'italic' },
  imgViewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  imgViewerImg: { width: '100%', height: '100%' },
  imgViewerClose: {
    position: 'absolute', top: 52, right: 18, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 22,
    padding: 10,
  },
  systemRow: { alignItems: 'center', marginVertical: 4 },
  systemText: { color: TEXT2, fontSize: 12, backgroundColor: SURFACE, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 3 },
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

// ─── Onglet Profil — page unique complète ────────────────────────────────────

// ── Onglet: Historique des courses ───────────────────────────────────────────
function HistoriqueTab() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ deliveries: any[] }>('/api/deliveries/history')
      .then((res) => setCourses(res.deliveries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 100, paddingTop: 8 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: TEXT }}>Historique</Text>
        <Text style={{ fontSize: 13, color: TEXT2, marginTop: 2 }}>{courses.length} course{courses.length !== 1 ? 's' : ''} terminée{courses.length !== 1 ? 's' : ''}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={PRIMARY} style={{ marginVertical: 40 }} />
      ) : courses.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 60, gap: 12 }}>
          <Icon name="history" size={44} color={TEXT2} strokeWidth={1.5} />
          <Text style={{ fontSize: 15, color: TEXT2 }}>Aucune course terminée</Text>
        </View>
      ) : (
        <View style={[styles.infoCard, { gap: 0 }]}>
          {courses.map((c, i) => {
            const isDone = c.status === 'done';
            const statusLabel = isDone ? 'Livrée' : 'Annulée';
            const statusColor = isDone ? '#1a7a35' : '#c0392b';
            const date = new Date(c.createdAt).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            });
            return (
              <View key={c.id} style={[styles.histCourseRow, i === courses.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.histCourseIcon}>
                  <Text style={{ color: '#fff', fontSize: 16 }}>🛵</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histCourseLabel}>{c.clientAlias ?? 'Course'}</Text>
                  <Text style={styles.histCourseDate}>{date}</Text>
                  {c.price != null && (
                    <Text style={{ fontSize: 13, color: '#1a7a35', fontWeight: '600', marginTop: 2 }}>
                      {c.price} MRU
                    </Text>
                  )}
                </View>
                <View style={[styles.histCourseBadge, { backgroundColor: statusColor + '20' }]}>
                  <Text style={[styles.histCourseBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function ProfilTab() {
  const { driver, phone, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState(driver?.name ?? '');
  const [saving, setSaving] = useState(false);

  // Documents sub-page
  const [showDocs, setShowDocs] = useState(false);
  // Wallet recharge sub-page
  const [showWallet, setShowWallet] = useState(false);

  const initial = (editName || driver?.name)?.charAt(0).toUpperCase() ?? '?';

  useEffect(() => {
    setEditName(driver?.name ?? '');
    api<{ balance: number; transactions: any[] }>('/api/wallet')
      .then((res) => {
        setBalance(res.balance ?? 0);
        setTransactions(res.transactions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveProfile = async () => {
    if (!editName.trim()) { Alert.alert('Erreur', 'Le nom ne peut pas être vide.'); return; }
    setSaving(true);
    try {
      await api('/api/drivers/me', { method: 'PATCH', body: { name: editName.trim() } });
      setEditMode(false);
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder les modifications.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () =>
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: logout },
    ]);

  if (showDocs) return <DocumentsView onBack={() => setShowDocs(false)} />;
  if (showWallet) return <WalletView onBack={() => setShowWallet(false)} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={[styles.header, { justifyContent: 'space-between' }]}>
        <Text style={styles.headerBrand}>Mon profil</Text>
        {editMode ? (
          <TouchableOpacity
            style={profilStyles.saveBtn}
            onPress={saveProfile}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={profilStyles.saveBtnText}>Enregistrer</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={profilStyles.editHeaderBtn}
            onPress={() => setEditMode(true)}
            activeOpacity={0.8}
          >
            <Icon name="edit" size={16} color="#fff" strokeWidth={1.75} />
            <Text style={profilStyles.editHeaderBtnText}>Modifier</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Hero — avatar + nom + téléphone */}
      <View style={profilStyles.hero}>
        <View style={profilStyles.avatarWrap}>
          <View style={profilStyles.avatar}>
            <Text style={profilStyles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileAvatarBadge}>
            <Text style={{ fontSize: 10, color: '#fff' }}>★</Text>
          </View>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          {editMode ? (
            <TextInput
              style={profilStyles.nameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Votre nom"
              placeholderTextColor={TEXT2}
              autoFocus
            />
          ) : (
            <Text style={profilStyles.heroName}>{driver?.name ?? '—'}</Text>
          )}
          <Text style={profilStyles.heroPhone}>{phone ?? '—'}</Text>
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>Compte vérifié</Text>
          </View>
        </View>
      </View>

      {/* Stats row */}
      <View style={profilStyles.statsRow}>
        <View style={profilStyles.statItem}>
          <Text style={profilStyles.statValue}>★ 4.8</Text>
          <Text style={profilStyles.statLabel}>Note</Text>
        </View>
        <View style={profilStyles.statDivider} />
        <View style={profilStyles.statItem}>
          <Text style={profilStyles.statValue}>Jan 2025</Text>
          <Text style={profilStyles.statLabel}>Membre depuis</Text>
        </View>
      </View>

      {/* Wallet card */}
      <View style={profilStyles.walletSection}>
        <View style={profilStyles.walletHeader}>
          <Text style={profilStyles.walletTitle}>Mon Wallet</Text>
          <TouchableOpacity onPress={() => setShowWallet(true)} activeOpacity={0.7}>
            <Text style={profilStyles.walletLink}>Recharger →</Text>
          </TouchableOpacity>
        </View>
        <View style={profilStyles.walletCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletLabel}>Solde disponible</Text>
            <Text style={styles.walletAmount}>
              {balance !== null ? `${balance.toFixed(0)} MRU` : '— MRU'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
              Minimum requis : 200 MRU
            </Text>
          </View>
        </View>
        {/* Dernières transactions */}
        {transactions.length > 0 && (
          <View style={[styles.infoCard, { marginHorizontal: 0, marginTop: 10, marginBottom: 0 }]}>
            <Text style={styles.sectionLabel}>DERNIÈRES TRANSACTIONS</Text>
            {transactions.slice(0, 4).map((tx, i) => {
              const isPos = tx.amount > 0;
              const date = new Date(tx.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
              return (
                <View
                  key={tx.id}
                  style={[styles.histRow, i === Math.min(transactions.length, 4) - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={[styles.histIcon, { backgroundColor: isPos ? 'rgba(52,199,89,.12)' : 'rgba(255,149,0,.12)' }]}>
                    <Icon name={isPos ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={isPos ? '#1a7a35' : '#b86800'} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histLabel}>{tx.description ?? tx.type}</Text>
                    <Text style={styles.histDate}>{date}</Text>
                  </View>
                  <Text style={[styles.histAmount, { color: isPos ? '#1a7a35' : '#b86800' }]}>
                    {isPos ? '+' : '-'}{Math.abs(tx.amount).toFixed(0)} MRU
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Informations personnelles */}
      <View style={profilStyles.section}>
        <View style={profilStyles.sectionHeaderRow}>
          <Text style={profilStyles.sectionTitle}>Informations</Text>
        </View>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Nom</Text>
            {editMode ? (
              <TextInput
                style={profilStyles.inlineInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Votre nom"
                placeholderTextColor={TEXT2}
              />
            ) : (
              <Text style={styles.infoVal}>{driver?.name ?? '—'}</Text>
            )}
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoKey}>Téléphone</Text>
            <Text style={styles.infoVal}>{phone ?? '—'}</Text>
          </View>
        </View>
      </View>

      {/* Documents */}
      <View style={profilStyles.section}>
        <TouchableOpacity
          style={profilStyles.docsBtn}
          onPress={() => setShowDocs(true)}
          activeOpacity={0.8}
        >
          <View style={[styles.menuIconWrap, { backgroundColor: '#EDE7F6' }]}>
            <Icon name="file-text" size={20} color="#5E35B1" strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Mes documents</Text>
            <Text style={styles.menuSub}>Carte grise, identité, photo véhicule</Text>
          </View>
          <Icon name="chevron-right" size={18} color={TEXT2} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      {/* Déconnexion */}
      <TouchableOpacity style={[styles.logoutBtn, { marginTop: 8 }]} onPress={handleLogout} activeOpacity={0.75}>
        <Icon name="logout" size={18} color="#e53935" />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const profilStyles = StyleSheet.create({
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 20, backgroundColor: CARD,
    borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#C7E0F4', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#1565C0' },
  heroName: { fontSize: 20, fontWeight: '800', color: TEXT },
  heroPhone: { fontSize: 13, color: TEXT2 },
  nameInput: {
    fontSize: 18, fontWeight: '700', color: TEXT,
    borderBottomWidth: 1.5, borderBottomColor: PRIMARY,
    paddingVertical: 2, paddingHorizontal: 0,
  },
  statsRow: {
    flexDirection: 'row', backgroundColor: CARD,
    paddingVertical: 16, paddingHorizontal: 8,
    marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 17, fontWeight: '800', color: TEXT },
  statLabel: { fontSize: 11, color: TEXT2, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: BORDER, marginVertical: 4 },
  walletSection: {
    marginHorizontal: 16, marginBottom: 16,
  },
  walletHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  walletTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  walletLink: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
  walletCard: {
    borderRadius: 18, padding: 20,
    backgroundColor: PRIMARY,
    flexDirection: 'row', alignItems: 'center',
  },
  section: { marginHorizontal: 16, marginBottom: 12 },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  sectionCount: { fontSize: 13, color: TEXT2 },
  inlineInput: {
    fontSize: 14, color: TEXT, flex: 1, textAlign: 'right',
    borderBottomWidth: 1, borderBottomColor: PRIMARY,
    paddingVertical: 2,
  },
  docsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD, borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  editHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  editHeaderBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    minWidth: 90, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

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

// ── Sous-page: Wallet ─────────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'bankily' as const, uri: BANKILY_URI,  label: 'Bankily'  },
  { id: 'sedad'   as const, uri: SEDAD_URI,    label: 'Sedad'    },
  { id: 'masrivi' as const, uri: MASRIVI_URI,  label: 'Masrivi'  },
] as const;
type Provider = typeof PROVIDERS[number]['id'];

const BANKILY_MERCHANT_CODE = '021065'; // Code marchand Bankily VECTO — à mettre à jour

function BankilyPayModal({ visible, onClose, onSuccess }: {
  visible: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [bpayCode, setBpayCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setAmount(''); setPhone(''); setBpayCode(''); };

  const handleRecharge = async () => {
    if (!parseInt(amount) || parseInt(amount) < 100) { Alert.alert('Erreur', 'Montant minimum : 100 MRU'); return; }
    if (!phone.trim()) { Alert.alert('Erreur', 'Numéro Bankily requis.'); return; }
    if (!bpayCode || bpayCode.length !== 4) { Alert.alert('Erreur', 'Code B-Pay à 4 chiffres requis.'); return; }
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/api/wallet/recharge', {
        method: 'POST',
        body: { amount: parseInt(amount), provider: 'bankily', bpayCode, phoneNumber: phone.trim() },
      });
      Alert.alert('Demande envoyée', res.message);
      reset();
      onSuccess();
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer la demande.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>Recharge B-Pay : {BANKILY_MERCHANT_CODE}</Text>
          <TextInput style={styles.modalInput} placeholder="Montant en Ouguiya Nouvelle"
            placeholderTextColor={TEXT2} keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <View style={styles.modalDivider} />
          <TextInput style={styles.modalInput} placeholder="Bankily"
            placeholderTextColor={TEXT2} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <View style={styles.modalDivider} />
          <TextInput style={styles.modalInput} placeholder="Passcode"
            placeholderTextColor={TEXT2} keyboardType="numeric" maxLength={4} value={bpayCode} onChangeText={setBpayCode} />
          <View style={styles.modalBtns}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Text style={styles.modalBtnCancel}>ANNULER</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRecharge} disabled={submitting}>
              {submitting ? <ActivityIndicator color={BRAND} size="small" /> : <Text style={styles.modalBtnOk}>RECHARGER</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SedadInitModal({ visible, onClose, onInitiate, submitting }: {
  visible: boolean; onClose: () => void; onInitiate: (amount: string) => void; submitting: boolean;
}) {
  const [amount, setAmount] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>Recharge Sedad</Text>
          <TextInput style={styles.modalInput} placeholder="Montant (MRU)"
            placeholderTextColor={TEXT2} keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <View style={styles.modalBtns}>
            <TouchableOpacity onPress={() => { setAmount(''); onClose(); }}>
              <Text style={styles.modalBtnCancel}>ANNULER</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onInitiate(amount)} disabled={submitting}>
              {submitting ? <ActivityIndicator color={BRAND} size="small" /> : <Text style={styles.modalBtnOk}>INITIER</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MasriviPayModal({ visible, onClose, onSuccess }: {
  visible: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRecharge = async () => {
    if (!parseInt(amount) || parseInt(amount) < 100) { Alert.alert('Erreur', 'Montant minimum : 100 MRU'); return; }
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/api/wallet/recharge', {
        method: 'POST', body: { amount: parseInt(amount), provider: 'masrivi' },
      });
      Alert.alert('Demande envoyée', res.message);
      setAmount('');
      onSuccess();
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer la demande.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>Recharge Masrivi</Text>
          <TextInput style={styles.modalInput} placeholder="Montant (MRU)"
            placeholderTextColor={TEXT2} keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <View style={styles.modalBtns}>
            <TouchableOpacity onPress={() => { setAmount(''); onClose(); }}>
              <Text style={styles.modalBtnCancel}>ANNULER</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRecharge} disabled={submitting}>
              {submitting ? <ActivityIndicator color={BRAND} size="small" /> : <Text style={styles.modalBtnOk}>RECHARGER</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SedadGuideView({
  amount,
  refCode,
  onBack,
}: {
  amount: string;
  refCode: string;
  onBack: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (text: string, key: string) => {
    try { await Clipboard.setStringAsync(text); } catch {}
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 20 }}>

        {/* Étape 1 */}
        <View style={styles.bpayCard}>
          <View style={styles.bpayStepRow}>
            <View style={styles.sedadStepBubble}><Text style={styles.bpayStepNum}>1</Text></View>
            <Text style={styles.bpayStepTitle}>Étape 1</Text>
          </View>
          <Text style={styles.bpayStepDesc}>Copiez le code de paiement.</Text>
          <View style={styles.sedadCodeBox}>
            <Text style={styles.sedadCodeLabel}>Code de paiement :</Text>
            <Text style={styles.sedadCodeValue}>{refCode}</Text>
          </View>
          <TouchableOpacity style={styles.sedadCopyBtnFull} onPress={() => copyText(refCode, 'ref')}>
            <Icon name={copiedKey === 'ref' ? 'check' : 'copy'} size={16} color="#fff" strokeWidth={2.5} />
            <Text style={styles.sedadCopyBtnFullText}>{copiedKey === 'ref' ? 'Copié !' : 'Copier'}</Text>
          </TouchableOpacity>
        </View>

        {/* Étape 2 */}
        <View style={styles.bpayCard}>
          <View style={styles.bpayStepRow}>
            <View style={styles.sedadStepBubble}><Text style={styles.bpayStepNum}>2</Text></View>
            <Text style={styles.bpayStepTitle}>Étape 2</Text>
          </View>
          <Text style={styles.bpayStepDesc}>Connectez-vous à l'application Sedad Bank.</Text>
        </View>

        {/* Étape 3 */}
        <View style={styles.bpayCard}>
          <View style={styles.bpayStepRow}>
            <View style={styles.sedadStepBubble}><Text style={styles.bpayStepNum}>3</Text></View>
            <Text style={styles.bpayStepTitle}>Étape 3</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.bpayStepDesc, { flex: 1, marginBottom: 0 }]}>Choisissez l'option Paiements.</Text>
            <View style={styles.sedadPayIconBox}>
              <Icon name="credit-card" size={28} color={TEXT2} strokeWidth={1.5} />
              <Text style={styles.sedadPayIconLabel}>Paiements</Text>
            </View>
          </View>
        </View>

        {/* Étape 4 */}
        <View style={styles.bpayCard}>
          <View style={styles.bpayStepRow}>
            <View style={styles.sedadStepBubble}><Text style={styles.bpayStepNum}>4</Text></View>
            <Text style={styles.bpayStepTitle}>Étape 4</Text>
          </View>
          <Text style={styles.bpayStepDesc}>Ajoutez le code de paiement copié, puis appuyez sur Payer.</Text>
          <View style={styles.sedadMockScreen}>
            <Text style={styles.sedadMockTitle}>Paiements</Text>
            <View style={styles.sedadMockTabs}>
              <View style={styles.sedadMockTabActive}><Text style={styles.sedadMockTabActiveText}>Sedad</Text></View>
              <View><Text style={styles.sedadMockTabText}>GIMTEL</Text></View>
            </View>
            <Text style={styles.sedadMockHint}>Entrez un code de paiement ou scanner un QR Code</Text>
            <View style={styles.sedadMockInput} />
            <View style={styles.sedadMockBtns}>
              <View style={styles.sedadMockPayBtn}><Text style={styles.sedadMockPayBtnText}>Payer</Text></View>
              <View style={styles.sedadMockScanBtn}><Text style={styles.sedadMockScanBtnText}>Scanner</Text></View>
            </View>
          </View>
        </View>

        {/* Étape 5 */}
        <View style={styles.bpayCard}>
          <View style={styles.bpayStepRow}>
            <View style={styles.sedadStepBubble}><Text style={styles.bpayStepNum}>5</Text></View>
            <Text style={styles.bpayStepTitle}>Étape 5</Text>
          </View>
          <Text style={[styles.bpayStepDesc, { marginBottom: 0 }]}>Retournez dans l'application Vecto pour suivre votre commande.</Text>
        </View>

      </ScrollView>

      {/* Barre basse fixe */}
      <View style={styles.sedadFooter}>
        <View style={styles.sedadFooterRow}>
          <Text style={styles.bpayFooterLabel}>Total à payer :</Text>
          <Text style={styles.sedadFooterAmount}>{amount} MRU</Text>
        </View>
        <TouchableOpacity style={styles.sedadRetourBtn} onPress={onBack}>
          <Text style={styles.sedadRetourBtnText}>Retour</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function WalletView({ onBack }: { onBack: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [activeModal, setActiveModal] = useState<Provider | null>(null);
  const [showSedadGuide, setShowSedadGuide] = useState(false);
  const [sedadRefCode, setSedadRefCode] = useState('');
  const [sedadAmt, setSedadAmt] = useState('');
  const [sedadSubmitting, setSedadSubmitting] = useState(false);

  const refreshWallet = () => {
    api<{ balance: number; transactions: any[] }>('/api/wallet')
      .then((d) => { setBalance(d.balance); setTransactions(d.transactions); })
      .catch(() => {});
  };

  useEffect(() => { refreshWallet(); }, []);

  const handleSedadInitiate = async (amount: string) => {
    const amt = parseInt(amount);
    if (!amt || amt < 100) { Alert.alert('Erreur', 'Montant minimum : 100 MRU'); return; }
    setSedadSubmitting(true);
    try {
      const res = await api<{ message: string; referenceCode: string }>('/api/wallet/recharge', {
        method: 'POST', body: { amount: amt, provider: 'sedad' },
      });
      setSedadAmt(amount);
      setSedadRefCode(res.referenceCode);
      setActiveModal(null);
      setShowSedadGuide(true);
    } catch {
      Alert.alert('Erreur', "Impossible d'initier le paiement.");
    } finally {
      setSedadSubmitting(false);
    }
  };

  const closeSedadGuide = () => {
    setShowSedadGuide(false);
    setSedadAmt('');
    setSedadRefCode('');
    refreshWallet();
  };

  const txIcon = (type: string) =>
    type === 'recharge' ? { iconName: 'arrow-up-right', color: '#1a7a35', bg: 'rgba(52,199,89,.12)' }
    : type === 'commission' ? { iconName: 'arrow-down-left', color: '#b86800', bg: 'rgba(255,149,0,.12)' }
    : { iconName: 'arrow-up-right', color: '#1a7a35', bg: 'rgba(52,199,89,.12)' };

  if (showSedadGuide) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={closeSedadGuide} style={styles.subBackBtn}>
            <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.subTitle}>Paiement Sedad</Text>
        </View>
        <SedadGuideView amount={sedadAmt} refCode={sedadRefCode} onBack={closeSedadGuide} />
      </View>
    );
  }

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: '#ECECEC' }} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={onBack} style={styles.subBackBtn}>
            <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.subTitle}>Portail de recharge</Text>
        </View>

        {/* Solde */}
        <View style={styles.portalSoldeRow}>
          <Text style={styles.portalSoldeLabel}>Solde :</Text>
          <Text style={styles.portalSoldeAmount}>
            {balance !== null ? balance.toFixed(1) : '—'}
          </Text>
        </View>
        <View style={styles.portalDivider} />

        {/* Cartes fournisseurs */}
        {PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={styles.portalCard}
            onPress={() => setActiveModal(p.id)}
            activeOpacity={0.7}
          >
            <Image source={{ uri: p.uri }} style={styles.portalCardLogo} resizeMode="contain" />
            <Text style={styles.portalCardLabel}>{p.label.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}

        {/* Historique */}
        {transactions.length > 0 && (
          <>
            <Text style={[styles.histSectionTitle, { marginTop: 12 }]}>Historique</Text>
            <View style={styles.infoCard}>
              {transactions.map((tx, i) => {
                const { iconName, color, bg } = txIcon(tx.type);
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

      <BankilyPayModal
        visible={activeModal === 'bankily'}
        onClose={() => setActiveModal(null)}
        onSuccess={() => { setActiveModal(null); refreshWallet(); }}
      />
      <SedadInitModal
        visible={activeModal === 'sedad'}
        onClose={() => setActiveModal(null)}
        onInitiate={handleSedadInitiate}
        submitting={sedadSubmitting}
      />
      <MasriviPayModal
        visible={activeModal === 'masrivi'}
        onClose={() => setActiveModal(null)}
        onSuccess={() => { setActiveModal(null); refreshWallet(); }}
      />
    </>
  );
}

// ── Sous-page: Mes documents ─────────────────────────────────────────────────
type DocField = 'photo_driver' | 'carte_grise_front' | 'carte_grise_back'
  | 'carte_identite_front' | 'carte_identite_back' | 'photo_vehicule';

const DOC_ROWS: { field: DocField; label: string; hint: string }[] = [
  { field: 'photo_driver',         label: 'Ma photo',                hint: 'Photo de profil du livreur' },
  { field: 'carte_grise_front',    label: 'Carte grise recto',       hint: 'Face avant de la carte grise' },
  { field: 'carte_grise_back',     label: 'Carte grise verso',       hint: 'Face arrière de la carte grise' },
  { field: 'carte_identite_front', label: "Pièce d'identité recto",  hint: 'Carte nationale ou passeport' },
  { field: 'carte_identite_back',  label: "Pièce d'identité verso",  hint: 'Face arrière' },
  { field: 'photo_vehicule',       label: 'Photo du véhicule',       hint: 'Photo de votre moto ou véhicule' },
];

function DocumentsView({ onBack }: { onBack: () => void }) {
  const [docs, setDocs] = useState<Record<string, string | null>>({
    photo_driver: null, carte_grise_front: null, carte_grise_back: null,
    carte_identite_front: null, carte_identite_back: null, photo_vehicule: null,
  });
  const [matricule, setMatricule] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ driver: any }>('/api/drivers/me')
      .then(({ driver: d }) => {
        setDocs({
          photo_driver: d.photo_driver ?? null,
          carte_grise_front: d.carte_grise_front ?? null,
          carte_grise_back: d.carte_grise_back ?? null,
          carte_identite_front: d.carte_identite_front ?? null,
          carte_identite_back: d.carte_identite_back ?? null,
          photo_vehicule: d.photo_vehicule ?? null,
        });
        setMatricule(d.matricule ?? '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const doUpload = async (field: DocField, uri: string, mime: string) => {
    setUploading(field);
    try {
      const ext = uri.split('.').pop() ?? 'jpg';
      const fd = new FormData();
      fd.append('file', { uri, type: mime, name: `${field}.${ext}` } as any);
      const { url } = await uploadFile('/api/upload', fd);
      await api('/api/drivers/me/documents', { method: 'PATCH', body: { [field]: url } });
      setDocs((prev) => ({ ...prev, [field]: url }));
    } catch {
      Alert.alert('Erreur', "Impossible d'uploader la photo. Réessayez.");
    } finally {
      setUploading(null);
    }
  };

  const pickFromLibrary = async (field: DocField) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "Activez l'accès à la galerie."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await doUpload(field, asset.uri, asset.mimeType ?? 'image/jpeg');
  };

  const pickFromCamera = async (field: DocField) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "Activez l'accès à la caméra."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await doUpload(field, asset.uri, asset.mimeType ?? 'image/jpeg');
  };

  const showOptions = (field: DocField) => {
    if (uploading) return;
    Alert.alert('Ajouter une photo', 'Choisissez la source', [
      { text: 'Prendre une photo', onPress: () => pickFromCamera(field) },
      { text: 'Galerie',           onPress: () => pickFromLibrary(field) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const saveMatricule = async () => {
    setSaving(true);
    try {
      await api('/api/drivers/me/documents', { method: 'PATCH', body: { matricule: matricule.trim() } });
      Alert.alert('Enregistré', 'Matricule mis à jour.');
    } catch {
      Alert.alert('Erreur', "Impossible d'enregistrer le matricule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.subBackBtn}>
          <Icon name="chevron-left" size={24} color={TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Mes documents</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={[styles.infoCard, { gap: 0 }]}>
            <Text style={styles.sectionLabel}>DOCUMENTS</Text>
            {DOC_ROWS.map(({ field, label, hint }, i) => {
              const url = docs[field];
              const isUp = uploading === field;
              return (
                <View
                  key={field}
                  style={[
                    docStyles.row,
                    i < DOC_ROWS.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: BORDER },
                  ]}
                >
                  <TouchableOpacity
                    style={docStyles.thumbWrap}
                    onPress={() => showOptions(field)}
                    activeOpacity={0.75}
                  >
                    {isUp ? (
                      <View style={docStyles.thumbPlaceholder}>
                        <ActivityIndicator color={PRIMARY} size="small" />
                      </View>
                    ) : url ? (
                      <Image source={{ uri: url }} style={docStyles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={docStyles.thumbPlaceholder}>
                        <Icon name="camera" size={22} color={TEXT2} strokeWidth={1.5} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={docStyles.label}>{label}</Text>
                    <Text style={docStyles.hint}>{url ? '✓ Ajouté' : hint}</Text>
                  </View>
                  <TouchableOpacity
                    style={[docStyles.uploadBtn, isUp && { opacity: 0.5 }]}
                    onPress={() => showOptions(field)}
                    disabled={!!uploading}
                    activeOpacity={0.75}
                  >
                    <Text style={docStyles.uploadBtnText}>{url ? 'Modifier' : 'Ajouter'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.sectionLabel}>VÉHICULE</Text>
            <Text style={styles.fieldLabel}>Matricule (immatriculation)</Text>
            <TextInput
              style={[styles.fieldBox, { color: TEXT, marginBottom: 12 }]}
              placeholder="Ex: 1234 NKT A"
              placeholderTextColor={TEXT2}
              value={matricule}
              onChangeText={setMatricule}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={[styles.validateBtn, saving && { opacity: 0.5 }]}
              onPress={saveMatricule}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.validateBtnText}>Enregistrer le matricule</Text>
              }
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const docStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  thumbWrap: { flexShrink: 0 },
  thumb: { width: 64, height: 52, borderRadius: 10 },
  thumbPlaceholder: {
    width: 64, height: 52, borderRadius: 10,
    backgroundColor: SURFACE, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  label: { fontSize: 14, fontWeight: '600', color: TEXT },
  hint: { fontSize: 12, color: TEXT2, marginTop: 2 },
  uploadBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: TEXT2 },
});

// ─── Course Progress Bar ─────────────────────────────────────────────────────

const COURSE_STEPS = ['Acceptée', 'En livraison', 'Terminée'] as const;

function CourseProgressBar({ status }: { status?: string }) {
  const doneIdx = status === 'in_progress' ? 1 : status === 'done' ? 2 : 0;

  return (
    <View style={cpbStyles.row}>
      {COURSE_STEPS.map((label, i) => (
        <View key={i} style={cpbStyles.stepWrap}>
          {i > 0 && (
            <View style={[cpbStyles.line, i <= doneIdx && cpbStyles.lineFilled]} />
          )}
          <View style={cpbStyles.stepItem}>
            <View style={[
              cpbStyles.dot,
              i < doneIdx ? cpbStyles.dotDone
                : i === doneIdx ? cpbStyles.dotCurrent
                : cpbStyles.dotPending,
            ]} />
            <Text style={[cpbStyles.label, i <= doneIdx ? cpbStyles.labelDone : cpbStyles.labelPending]}>
              {label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const cpbStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  line: { flex: 1, height: 2, backgroundColor: '#2a2a2a' },
  lineFilled: { backgroundColor: '#4caf50' },
  stepItem: { alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotDone: { backgroundColor: '#4caf50' },
  dotCurrent: { backgroundColor: PRIMARY, borderWidth: 2, borderColor: PRIMARY },
  dotPending: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#444' },
  label: { fontSize: 8, marginTop: 3, textAlign: 'center', width: 48 },
  labelDone: { color: '#4caf50', fontWeight: '600' },
  labelPending: { color: '#444' },
});

// ─── Bottom Tab Bar ──────────────────────────────────────────────────────────

function BottomTabBar({
  active, onSelect, adminUnread, chatUnread,
}: { active: Tab; onSelect: (t: Tab) => void; adminUnread: number; chatUnread: number }) {
  const tabs: { key: Tab; icon: 'scooter' | 'history' | 'chat' | 'headset' | 'person'; label: string }[] = [
    { key: 'courses',    icon: 'scooter',  label: 'Courses'    },
    { key: 'chats',      icon: 'chat',     label: 'Chats'      },
    { key: 'admin',      icon: 'headset',  label: 'Appels'     },
    { key: 'historique', icon: 'history',  label: 'Historique' },
    { key: 'profil',     icon: 'person',   label: 'Profil'     },
  ];

  return (
    <View style={styles.tabBarWrap}>
      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const isActive = active === t.key;
          const badgeCount = t.key === 'admin' ? adminUnread : t.key === 'chats' ? chatUnread : 0;
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
                  size={20}
                  color={isActive ? '#fff' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {badgeCount > 0 && (
                  <View style={tabBadgeStyle.dot}>
                    <Text style={tabBadgeStyle.text}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[tabBadgeStyle.label, isActive && tabBadgeStyle.labelActive]}>
                {t.label}
              </Text>
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
  label: {
    fontSize: 9, fontWeight: '500', color: 'rgba(255,255,255,0.45)',
    marginTop: 3, textAlign: 'center',
  },
  labelActive: { color: '#fff', fontWeight: '700' },
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
    flexDirection: 'column',
    backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#4caf50',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  activeCourseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  modalTitle: { color: PRIMARY, fontSize: 18, fontWeight: '700' },
  modalCountdown: {
    backgroundColor: '#FF9500', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  modalCountdownRed: { backgroundColor: '#FF3B30' },
  modalCountdownText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
    backgroundColor: '#22C55E', alignItems: 'center',
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
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', gap: 6,
  },
  providerBtnActive: { borderColor: BRAND, backgroundColor: '#FFF5F0' },
  providerLogo: { width: '80%', height: 32 },
  providerBtnText: { fontSize: 11, fontWeight: '600', color: TEXT2 },
  providerBtnTextActive: { color: BRAND },
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
    borderRadius: 32,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  tabItem: {
    flex: 1, height: 54, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center', gap: 2,
  },
  tabItemActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },

  // B-Pay guide
  bpayCard: {
    backgroundColor: CARD, marginHorizontal: 16, borderRadius: 16,
    padding: 18, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  bpayStepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  bpayStepBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
  },
  bpayStepNum: { color: '#fff', fontSize: 13, fontWeight: '800' },
  bpayStepTitle: { fontSize: 12, fontWeight: '700', color: TEXT2, textTransform: 'uppercase', letterSpacing: 0.5 },
  bpayStepDesc: { fontSize: 14, color: TEXT, lineHeight: 20, marginBottom: 12 },
  bpayFieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bpayFieldLabel: { fontSize: 12, color: TEXT2, marginBottom: 2 },
  bpayFieldValue: { fontSize: 18, fontWeight: '700', color: TEXT },
  bpayCopyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: PRIMARY, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  bpayCopyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  bpayHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: BG, borderRadius: 8, padding: 10,
  },
  bpayHintText: { color: TEXT2, fontSize: 13 },
  bpayBankilyCard: {
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER, marginTop: 4,
  },
  bpayBankilyHeader: {
    backgroundColor: '#009EBD', paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', gap: 4,
  },
  bpayBankilyTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bpayBankilyIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  bpayBankilySub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  bpayCodePreview: { alignItems: 'center', paddingVertical: 16, gap: 10 },
  bpayCodeCircle: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2.5, borderColor: BRAND,
    justifyContent: 'center', alignItems: 'center',
  },
  bpayCodeCircleText: { fontSize: 20, fontWeight: '800', color: BRAND, letterSpacing: 4 },
  bpayCodePreviewLabel: { fontSize: 13, color: TEXT2 },
  bpayFooter: {
    backgroundColor: CARD, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  bpayFooterTotal: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  bpayFooterLabel: { fontSize: 14, color: TEXT },
  bpayFooterAmount: { fontSize: 16, fontWeight: '800', color: TEXT, flex: 1 },
  bpayFooterBtns: { flexDirection: 'row', gap: 10 },
  bpayRetourBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER, alignItems: 'center',
  },
  bpayRetourBtnText: { fontSize: 15, fontWeight: '600', color: TEXT },
  bpayContinuerBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: BRAND, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  bpayContinuerBtnFull: {
    backgroundColor: BRAND, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  bpayContinuerBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Portail de recharge
  portalSoldeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#ECECEC',
  },
  portalSoldeLabel: { fontSize: 20, fontWeight: '600', color: TEXT },
  portalSoldeAmount: { fontSize: 22, fontWeight: '800', color: '#4CAF50' },
  portalDivider: { height: 1, backgroundColor: '#D0D0D0', marginHorizontal: 0, marginBottom: 4 },
  portalCard: {
    backgroundColor: '#D8D8D8', marginHorizontal: 0, marginBottom: 4,
    paddingVertical: 18, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  portalCardLogo: { width: 120, height: 44 },
  portalCardLabel: { fontSize: 16, fontWeight: '700', color: TEXT },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: CARD, borderRadius: 8, padding: 20,
    width: '85%', shadowColor: '#000', shadowOpacity: 0.2,
    shadowRadius: 12, elevation: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 16 },
  modalInput: {
    fontSize: 15, color: TEXT, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalDivider: { height: 1, backgroundColor: BORDER },
  modalBtns: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 24,
    marginTop: 20,
  },
  modalBtnCancel: { fontSize: 14, fontWeight: '700', color: BRAND },
  modalBtnOk: { fontSize: 14, fontWeight: '700', color: BRAND },

  // Sedad guide
  sedadStepBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#8B7535', justifyContent: 'center', alignItems: 'center',
  },
  sedadCodeBox: {
    backgroundColor: BG, borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12,
  },
  sedadCodeLabel: { fontSize: 13, color: TEXT2, marginBottom: 4 },
  sedadCodeValue: { fontSize: 26, fontWeight: '800', color: TEXT, letterSpacing: 2 },
  sedadCopyBtnFull: {
    backgroundColor: PRIMARY, borderRadius: 10, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  sedadCopyBtnFullText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sedadPayIconBox: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    padding: 14, alignItems: 'center', gap: 6, minWidth: 80,
  },
  sedadPayIconLabel: { fontSize: 11, fontWeight: '600', color: TEXT2 },
  sedadMockScreen: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 10, overflow: 'hidden', marginTop: 4,
  },
  sedadMockTitle: { fontSize: 14, fontWeight: '700', color: TEXT, textAlign: 'center', padding: 10, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  sedadMockTabs: { flexDirection: 'row', gap: 8, padding: 8 },
  sedadMockTabActive: { backgroundColor: '#E6F2EA', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  sedadMockTabActiveText: { fontSize: 12, color: '#2E7D32', fontWeight: '600' },
  sedadMockTabText: { fontSize: 12, color: TEXT2, paddingVertical: 4 },
  sedadMockHint: { fontSize: 11, color: TEXT2, paddingHorizontal: 10, marginBottom: 6 },
  sedadMockInput: { height: 28, borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginHorizontal: 10, marginBottom: 8 },
  sedadMockBtns: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 10 },
  sedadMockPayBtn: { backgroundColor: '#4CAF50', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 6 },
  sedadMockPayBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  sedadMockScanBtn: { borderWidth: 1, borderColor: BORDER, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 6 },
  sedadMockScanBtnText: { fontSize: 12, color: TEXT2 },
  sedadFooter: {
    backgroundColor: CARD, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  sedadFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sedadFooterAmount: { fontSize: 17, fontWeight: '800', color: TEXT },
  sedadRetourBtn: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  sedadRetourBtnText: { fontSize: 15, fontWeight: '600', color: TEXT },
});

// ─── Modal raison d'annulation ────────────────────────────────────────────────

const CANCEL_REASONS = [
  'Panne de véhicule',
  'Zone inaccessible',
  'Client injoignable',
  'Adresse incorrecte',
  'Urgence personnelle',
];

function CancellationReasonModal({
  clientAlias,
  onSent,
}: {
  clientAlias: string;
  onSent: () => void;
}) {
  const [tab, setTab] = useState<'preset' | 'text' | 'audio'>('preset');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
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
    setRecSeconds(0);
    timerRef.current = setInterval(() => setRecSeconds((t) => t + 1), 1000);
  };

  const stopRecording = async () => {
    if (!recording) return;
    if (timerRef.current) clearInterval(timerRef.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    if (uri) setAudioUri(uri);
  };

  const handleSend = async () => {
    const prefix = `Annulation — ${clientAlias}`;

    if (tab === 'preset' && !selectedReason) {
      Alert.alert('', 'Veuillez choisir une raison.');
      return;
    }
    if (tab === 'text' && !customText.trim()) {
      Alert.alert('', 'Veuillez écrire un message.');
      return;
    }
    if (tab === 'audio' && !audioUri) {
      Alert.alert('', 'Veuillez enregistrer un message vocal.');
      return;
    }

    setSending(true);
    try {
      if (tab === 'audio') {
        await api('/api/drivers/cc-chat', {
          method: 'POST',
          body: { content: prefix, type: 'text' },
        });
        const fd = new FormData();
        fd.append('file', { uri: audioUri, type: 'audio/mp4', name: 'annulation.m4a' } as any);
        const { url } = await uploadFile('/api/upload', fd);
        await api('/api/drivers/cc-chat', {
          method: 'POST',
          body: { content: url, type: 'audio' },
        });
      } else {
        const reason = tab === 'preset' ? selectedReason! : customText.trim();
        await api('/api/drivers/cc-chat', {
          method: 'POST',
          body: { content: `${prefix} : ${reason}`, type: 'text' },
        });
      }
      onSent();
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer. Réessayez.");
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <View style={cancelStyles.overlay}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={cancelStyles.kvWrapper}
      >
        <View style={cancelStyles.box}>
          <View style={cancelStyles.headerRow}>
            <Icon name="alert-triangle" size={20} color="#f44336" />
            <Text style={cancelStyles.title}>Raison de l'annulation</Text>
          </View>
          <Text style={cancelStyles.subtitle}>Course : {clientAlias}</Text>

          <View style={cancelStyles.tabRow}>
            {(['preset', 'text', 'audio'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[cancelStyles.tab, tab === t && cancelStyles.tabActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[cancelStyles.tabText, tab === t && cancelStyles.tabTextActive]}>
                  {t === 'preset' ? 'Raison' : t === 'text' ? 'Message' : 'Vocal'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'preset' && (
            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
              {CANCEL_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[cancelStyles.reasonRow, selectedReason === r && cancelStyles.reasonRowActive]}
                  onPress={() => setSelectedReason(r)}
                >
                  <View style={[cancelStyles.radioCircle, selectedReason === r && cancelStyles.radioFilled]} />
                  <Text style={[cancelStyles.reasonText, selectedReason === r && cancelStyles.reasonTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {tab === 'text' && (
            <TextInput
              style={cancelStyles.textInput}
              placeholder="Expliquez la raison de l'annulation..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={customText}
              onChangeText={setCustomText}
            />
          )}

          {tab === 'audio' && (
            <View style={cancelStyles.audioSection}>
              {!audioUri ? (
                <>
                  <TouchableOpacity
                    style={[cancelStyles.recordBtn, !!recording && cancelStyles.recordBtnActive]}
                    onPress={recording ? stopRecording : startRecording}
                  >
                    <Icon name={recording ? 'square' : 'mic'} size={28} color="#fff" />
                  </TouchableOpacity>
                  {recording && <Text style={cancelStyles.recTimer}>{fmtTime(recSeconds)}</Text>}
                  <Text style={cancelStyles.recHint}>
                    {recording ? 'Appuyez pour arrêter' : 'Appuyez pour enregistrer'}
                  </Text>
                </>
              ) : (
                <View style={cancelStyles.audioReady}>
                  <Icon name="check" size={22} color="#4CAF50" />
                  <Text style={{ color: '#4CAF50', fontWeight: '600', marginLeft: 6 }}>
                    Message vocal prêt
                  </Text>
                  <TouchableOpacity onPress={() => setAudioUri(null)} style={{ marginLeft: 'auto' }}>
                    <Text style={{ color: '#f44336', fontSize: 13 }}>Recommencer</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[cancelStyles.sendBtn, sending && { opacity: 0.55 }]}
            onPress={handleSend}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={cancelStyles.sendBtnText}>Envoyer au centre d'appel</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const cancelStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 999,
  },
  kvWrapper: { width: '100%', alignItems: 'center' },
  box: {
    width: '90%', backgroundColor: '#fff', borderRadius: 16,
    padding: 20, gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 13, color: '#666' },
  tabRow: {
    flexDirection: 'row', gap: 6,
    borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  tabActive: { backgroundColor: '#FFF0F0' },
  tabText: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabTextActive: { color: '#f44336', fontWeight: '700' },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, paddingHorizontal: 8, borderRadius: 8, marginBottom: 4,
  },
  reasonRowActive: { backgroundColor: '#FFF0F0' },
  radioCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ccc' },
  radioFilled: { backgroundColor: '#f44336', borderColor: '#f44336' },
  reasonText: { fontSize: 14, color: '#333' },
  reasonTextActive: { fontWeight: '600', color: '#c62828' },
  textInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#333',
    minHeight: 100, textAlignVertical: 'top',
  },
  audioSection: { alignItems: 'center', gap: 10, paddingVertical: 10 },
  recordBtn: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#f44336',
    justifyContent: 'center', alignItems: 'center',
  },
  recordBtnActive: { backgroundColor: '#b71c1c' },
  recTimer: { fontSize: 20, fontWeight: '700', color: '#333', letterSpacing: 2 },
  recHint: { fontSize: 12, color: '#888' },
  audioReady: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#E8F5E9', borderRadius: 10, padding: 12, width: '100%',
  },
  sendBtn: {
    backgroundColor: '#f44336', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
