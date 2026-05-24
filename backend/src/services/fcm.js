import { env } from '../config/env.js';
import db from '../config/db.js';

let messaging = null;

// Initialisation optionnelle — si FCM_SERVICE_ACCOUNT absent, les fonctions sont no-op
export async function initFCM() {
  if (!env.FCM_SERVICE_ACCOUNT) {
    console.info('[fcm] FCM_SERVICE_ACCOUNT absent — notifications push désactivées');
    return;
  }

  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');

    const serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging();
    console.info('[fcm] Firebase Admin SDK initialisé');
  } catch (err) {
    console.error('[fcm] Initialisation échouée:', err.message);
  }
}

// Notifie tous les livreurs disponibles qu'une nouvelle course est dispo
export async function notifyAvailableDrivers(delivery) {
  if (!messaging) return;

  const tokens = await db('drivers')
    .where({ status: 'available' })
    .whereNotNull('fcm_token')
    .pluck('fcm_token');

  if (tokens.length === 0) return;

  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: 'Nouvelle course disponible',
      body: delivery.description || 'Une livraison attend un livreur',
    },
    data: {
      type: 'new_delivery',
      deliveryId: delivery.id,
      clientAlias: delivery.alias ?? '',
    },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
  });

  // Purger les tokens invalides
  const staleTokens = [];
  result.responses.forEach((resp, i) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      staleTokens.push(tokens[i]);
    }
  });
  if (staleTokens.length > 0) {
    await db('drivers').whereIn('fcm_token', staleTokens).update({ fcm_token: null });
  }
}

// Notifie le livreur assigné (backup si pas connecté en Socket.IO)
export async function notifyAssignedDriver(driverId, { title, body, data = {} }) {
  if (!messaging) return;

  const driver = await db('drivers').where({ id: driverId }).first('fcm_token');
  if (!driver?.fcm_token) return;

  await messaging.send({
    token: driver.fcm_token,
    notification: { title, body },
    data: { ...data },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  }).catch((err) => {
    if (err.code === 'messaging/registration-token-not-registered') {
      db('drivers').where({ id: driverId }).update({ fcm_token: null }).catch(() => {});
    }
  });
}
