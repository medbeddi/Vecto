import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
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
import { Icon } from '../components/Icon';
import { BRAND, BG, CARD } from '../lib/config';
import type { Delivery, RootStackParamList } from '../types';

type IncomingOrder = {
  deliveryId: string;
  clientAlias: string;
  createdAt: string;
  message: { type: string; content: string | null; meta: any };
};

type Nav = NativeStackNavigationProp<RootStackParamList, 'Deliveries'>;

// Notifications en avant-plan
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function DeliveriesScreen() {
  const navigation = useNavigation<Nav>();
  const { driver, logout } = useAuthStore();
  const { available, loadingDeliveries, loadAvailable, loadActiveCourses, upsertAvailable, removeAvailable, activeCourses, addActiveCourse } =
    useDeliveriesStore();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [connected, setConnected] = useState(socketService.connected);
  const [incomingOrder, setIncomingOrder] = useState<IncomingOrder | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Polling de l'état socket toutes les 3s
  useEffect(() => {
    const t = setInterval(() => setConnected(socketService.connected), 3000);
    return () => clearInterval(t);
  }, []);

  // Chargement initial + connexion socket
  useEffect(() => {
    loadAvailable();
    loadActiveCourses();
    registerFCMToken();

    // Écouter les nouveaux ordres en temps réel (broadcast)
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
      // Jouer le message audio si disponible
      if (order.message.type === 'audio' && order.message.content) {
        playAudio(order.message.content);
      }
      Notifications.scheduleNotificationAsync({
        content: {
          title: '🛵 Nouvelle course',
          body: order.message.type === 'audio' ? `Message vocal de ${order.clientAlias}` : (order.message.content ?? `Course de ${order.clientAlias}`),
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
    if (soundRef.current) { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); soundRef.current = null; }
  };

  const handleAccept = useCallback(
    async (delivery: Delivery) => {
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
        const msg =
          err.code === 'ALREADY_TAKEN'
            ? 'Cette course vient d\'être prise par un autre livreur.'
            : 'Impossible d\'accepter la course. Réessayez.';
        Alert.alert('Course indisponible', msg);
      } finally {
        setAccepting(null);
      }
    },
    [navigation, removeAvailable, addActiveCourse]
  );

  const handleRefuse = useCallback(async (delivery: Delivery) => {
    removeAvailable(delivery.id);
    try {
      await api(`/api/deliveries/${delivery.id}/refuse`, { method: 'POST' });
    } catch {}
  }, [removeAvailable]);

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={styles.root}>
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
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Liste */}
      {/* Modal ordre entrant */}
      <Modal visible={!!incomingOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🛵 Nouvelle course</Text>
            <Text style={styles.modalAlias}>{incomingOrder?.clientAlias}</Text>

            {incomingOrder?.message.type === 'audio' ? (
              <TouchableOpacity style={styles.playBtn} onPress={() => incomingOrder?.message.content && playAudio(incomingOrder.message.content)}>
                <Text style={styles.playBtnText}>▶ Écouter le message vocal</Text>
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
                style={[styles.acceptModalBtn, accepting && styles.btnOff]}
                disabled={!!accepting}
                onPress={async () => {
                  if (!incomingOrder) return;
                  stopAudio();
                  const fakeDelivery = { id: incomingOrder.deliveryId, clientAlias: incomingOrder.clientAlias, status: 'pending', createdAt: incomingOrder.createdAt } as Delivery;
                  setIncomingOrder(null);
                  await handleAccept(fakeDelivery);
                }}
              >
                {accepting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptModalBtnText}>✓ Accepter</Text>}
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
          <RefreshControl
            refreshing={loadingDeliveries}
            onRefresh={loadAvailable}
            tintColor={BRAND}
          />
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
            <ActivityIndicator color={BRAND} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}>
              <Icon name="scooter" size={56} color="#888" strokeWidth={1.5} />
              <Text style={styles.emptyText}>Aucune course disponible</Text>
              <Text style={styles.emptyHint}>Tirez pour actualiser</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <DeliveryCard
            delivery={item}
            onAccept={handleAccept}
            onRefuse={handleRefuse}
            accepting={accepting === item.id}
          />
        )}
      />
    </View>
  );
}

async function registerFCMToken() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    const tokenData = await Notifications.getDevicePushTokenAsync();
    await api('/api/drivers/fcm-token', {
      method: 'PUT',
      body: { token: tokenData.data },
    });
  } catch {
    // FCM optionnel — ne pas bloquer l'app
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  greeting: { color: '#fff', fontSize: 18, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: '#4caf50' },
  dotRed: { backgroundColor: '#f44336' },
  statusText: { color: '#888', fontSize: 12 },
  logoutBtn: {
    padding: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
  logoutText: { color: '#888', fontSize: 16 },
  list: { padding: 16, paddingBottom: 40 },
  empty: { alignItems: 'center', marginTop: 80, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: '#888', fontSize: 16, fontWeight: '600' },
  emptyHint: { color: '#555', fontSize: 13 },
  // Modal incoming order
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  modalTitle: { color: BRAND, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  modalAlias: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  modalMsg: { color: '#ccc', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  playBtn: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  playBtnText: { color: BRAND, fontSize: 15, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  dismissBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
  },
  dismissBtnText: { color: '#888', fontSize: 15, fontWeight: '600' },
  acceptModalBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: 'center',
  },
  acceptModalBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnOff: { opacity: 0.5 },
  activeSection: { marginBottom: 12 },
  activeSectionTitle: { color: BRAND, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  activeCourseCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#4caf50',
  },
  activeCourseLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50' },
  activeCourseAlias: { color: '#fff', fontWeight: '700', fontSize: 14 },
  activeCourseArrow: { color: BRAND, fontSize: 13, fontWeight: '600' },
  availableSectionTitle: { color: '#888', fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
});
