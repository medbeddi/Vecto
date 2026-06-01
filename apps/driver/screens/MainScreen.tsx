import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { useAuthStore } from '../store/auth.store';
import { useDeliveriesStore } from '../store/deliveries.store';
import { socketService } from '../lib/socket';
import { api } from '../lib/api';
import { DeliveryCard } from '../components/DeliveryCard';
import {
  PRIMARY, BG, CARD, BORDER, TEXT, TEXT2, SURFACE, BRAND,
} from '../lib/config';
import type { Delivery, RootStackParamList } from '../types';

type Tab = 'courses' | 'chats' | 'profil';
type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

type IncomingOrder = {
  deliveryId: string;
  clientAlias: string;
  createdAt: string;
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

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {activeTab === 'courses' && <CoursesTab />}
        {activeTab === 'chats' && <ChatsTab />}
        {activeTab === 'profil' && <ProfilTab />}
      </View>
      <BottomTabBar active={activeTab} onSelect={setActiveTab} />
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
  const [connected, setConnected] = useState(socketService.connected);
  const [incomingOrder, setIncomingOrder] = useState<IncomingOrder | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    const t = setInterval(() => setConnected(socketService.connected), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadAvailable();
    loadActiveCourses();
    registerFCMToken();

    const onNewOrder = (order: IncomingOrder) => {
      setIncomingOrder(order);
      upsertAvailable({
        id: order.deliveryId,
        clientAlias: order.clientAlias,
        createdAt: order.createdAt,
        status: 'pending',
        description: order.message.content ?? '',
        initialMediaType: order.message.type,
        initialMediaUrl: order.message.type === 'audio' ? order.message.content : null,
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
      setIncomingOrder((prev) => prev?.deliveryId === deliveryId ? null : prev);
    };

    socketService.on('new_order', onNewOrder);
    socketService.on('order_taken', onOrderTaken);
    return () => {
      socketService.off('new_order', onNewOrder);
      socketService.off('order_taken', onOrderTaken);
    };
  }, []);

  const playAudio = async (url: string) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
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
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Bonjour, {driver?.name} 👋</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.statusText}>
              {connected ? 'Connecté en temps réel' : 'Reconnexion...'}
            </Text>
          </View>
        </View>
      </View>

      {/* Modal nouvelle commande */}
      <Modal visible={!!incomingOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🛵 Nouvelle course</Text>
            <Text style={styles.modalAlias}>{incomingOrder?.clientAlias}</Text>

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
          activeCourses.length > 0 ? (
            <View style={styles.activeSection}>
              <Text style={styles.activeSectionTitle}>Mes courses actives ({activeCourses.length})</Text>
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
              {available.length > 0 && (
                <Text style={styles.availableSectionTitle}>Courses disponibles</Text>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          loadingDeliveries ? (
            <ActivityIndicator color={PRIMARY} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🛵</Text>
              <Text style={styles.emptyText}>Aucune course disponible</Text>
              <Text style={styles.emptyHint}>Tirez pour actualiser</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <DeliveryCard delivery={item} onAccept={handleAccept} accepting={accepting === item.id} />
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

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Mes discussions</Text>
      </View>
      {activeCourses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>Aucune discussion active</Text>
          <Text style={styles.emptyHint}>Acceptez une course pour discuter</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {activeCourses.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.chatRow}
              onPress={() => navigation.navigate('Chat', { delivery: d })}
              activeOpacity={0.75}
            >
              <View style={styles.chatAvatar}>
                <Text style={styles.chatAvatarText}>{d.clientAlias[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chatAlias}>{d.clientAlias}</Text>
                <Text style={styles.chatStatus}>
                  {d.status === 'assigned' ? 'En attente de départ' : 'En route'}
                </Text>
              </View>
              <Text style={styles.chatArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Onglet Profil ────────────────────────────────────────────────────────────

function ProfilTab() {
  const { driver, phone, logout } = useAuthStore();

  const initial = driver?.name?.charAt(0).toUpperCase() ?? '?';

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header profil */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.profileName}>{driver?.name ?? '—'}</Text>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingText}>★ 5.0  ·  0 courses</Text>
        </View>
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedText}>✓  Compte vérifié</Text>
        </View>
      </View>

      {/* Solde */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Solde disponible</Text>
        <Text style={styles.balanceAmount}>0 MRU</Text>
      </View>

      {/* Menu */}
      <View style={styles.menuCard}>
        <MenuItem icon="👤" label="Informations personnelles" sub={phone ?? '—'} />
        <MenuItem icon="💰" label="Wallet & Transactions" sub="Recharge, historique" />
        <MenuItem icon="🕒" label="Historique des courses" sub="Courses passées, revenus" />
        <MenuItem icon="🔔" label="Notifications" sub="Activées" last />
      </View>

      {/* Déconnexion */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>⬡  Se déconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function MenuItem({
  icon, label, sub, last,
}: {
  icon: string; label: string; sub: string; last?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.menuItem, last && { borderBottomWidth: 0 }]} activeOpacity={0.6}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuSub}>{sub}</Text>
      </View>
      <Text style={styles.menuChevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Bottom Tab Bar ──────────────────────────────────────────────────────────

function BottomTabBar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'courses', icon: '🛵', label: 'Courses' },
    { key: 'chats',   icon: '💬', label: 'Chats' },
    { key: 'profil',  icon: '👤', label: 'Profil' },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tabItem}
            onPress={() => onSelect(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

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
  content: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  greeting: { color: TEXT, fontSize: 18, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: '#4caf50' },
  dotRed: { backgroundColor: '#f44336' },
  statusText: { color: TEXT2, fontSize: 12 },

  // List
  list: { padding: 16, paddingBottom: 20 },
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
  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD, borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  chatAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: SURFACE, justifyContent: 'center', alignItems: 'center',
  },
  chatAvatarText: { fontSize: 20, fontWeight: '700', color: TEXT },
  chatAlias: { fontSize: 15, fontWeight: '700', color: TEXT },
  chatStatus: { fontSize: 12, color: TEXT2, marginTop: 2 },
  chatArrow: { fontSize: 22, color: TEXT2 },

  // Profile
  profileHeader: {
    alignItems: 'center', paddingTop: 60, paddingBottom: 24,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
    gap: 6,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 20, fontWeight: '800', color: TEXT },
  ratingRow: {},
  ratingText: { fontSize: 13, color: TEXT2 },
  verifiedBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  verifiedText: { fontSize: 12, color: '#2e7d32', fontWeight: '600' },
  balanceCard: {
    backgroundColor: PRIMARY, margin: 16, borderRadius: 16,
    padding: 20, gap: 4,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  balanceAmount: { color: '#fff', fontSize: 28, fontWeight: '800' },
  menuCard: {
    backgroundColor: CARD, marginHorizontal: 16, borderRadius: 16,
    overflow: 'hidden', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  menuIcon: { fontSize: 20 },
  menuLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  menuSub: { fontSize: 12, color: TEXT2, marginTop: 1 },
  menuChevron: { fontSize: 20, color: TEXT2 },
  logoutBtn: {
    marginHorizontal: 16, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
    backgroundColor: CARD, borderWidth: 1, borderColor: '#ffccbc',
  },
  logoutText: { color: '#e53935', fontSize: 15, fontWeight: '600' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingBottom: 20,
    paddingTop: 10,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabIcon: { fontSize: 22 },
  tabIconActive: {},
  tabLabel: { fontSize: 11, color: TEXT2, fontWeight: '500' },
  tabLabelActive: { color: PRIMARY, fontWeight: '700' },
});
