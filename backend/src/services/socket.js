import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { relayDriverMessage } from './relay.js';
import db from '../config/db.js';

let io = null;
const DRIVERS_ROOM = 'room:drivers';
const ADMINS_ROOM  = 'room:admins';

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
  });

  io.use((socket, next) => {
    const raw = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization;
    const token = raw?.replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      if (decoded.role === 'admin') {
        socket.data.admin = decoded;
      } else if (decoded.role === 'client') {
        socket.data.client = decoded;
      } else {
        socket.data.driver = decoded;
      }
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    // ── Admin ────────────────────────────────────────────────────────────────
    if (socket.data.admin) {
      socket.join(ADMINS_ROOM);
      // Envoyer les positions actuelles de tous les livreurs dès la connexion
      db('drivers')
        .whereNotNull('last_lat')
        .whereNotNull('last_lng')
        .select('id', 'name', 'last_lat', 'last_lng', 'last_seen', 'status', 'is_available')
        .then((rows) => {
          socket.emit('drivers_locations', rows.map((r) => ({
            driverId: r.id, name: r.name,
            lat: r.last_lat, lng: r.last_lng,
            lastSeen: r.last_seen, status: r.status,
            isAvailable: r.is_available,
          })));
        }).catch(() => {});
      socket.on('disconnect', () => {});
      return;
    }

    // ── Client ───────────────────────────────────────────────────────────────
    if (socket.data.client) {
      socket.on('join_delivery', ({ deliveryId }) => {
        if (deliveryId) socket.join(`course_${deliveryId}`);
      });
      socket.on('disconnect', () => {});
      return;
    }

    // ── Livreur ──────────────────────────────────────────────────────────────
    const driverId   = socket.data.driver?.id;
    const driverName = socket.data.driver?.name;
    socket.join(DRIVERS_ROOM);
    socket.join(`driver:${driverId}`);

    socket.on('join_room', ({ deliveryId }) => {
      if (!deliveryId) return;
      socket.join(`course_${deliveryId}`);
    });

    socket.on('driver_message', async ({ deliveryId, type, content, meta }) => {
      if (!driverId || !deliveryId) return;
      try {
        await relayDriverMessage(deliveryId, driverId, { type, content, meta });
      } catch (err) {
        socket.emit('relay_error', { deliveryId, code: err.code ?? 'RELAY_FAILED' });
      }
    });

    // Mise à jour GPS du livreur → stocker en DB + diffuser aux admins
    socket.on('driver_location', async ({ lat, lng }) => {
      if (!driverId || typeof lat !== 'number' || typeof lng !== 'number') return;
      try {
        await db('drivers').where({ id: driverId }).update({ last_lat: lat, last_lng: lng, last_seen: db.fn.now() });
        const driver = await db('drivers').where({ id: driverId }).first('status', 'is_available');
        io.to(ADMINS_ROOM).emit('driver_location', {
          driverId, name: driverName, lat, lng,
          status: driver?.status, isAvailable: driver?.is_available,
        });
      } catch {}
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO non initialisé');
  return io;
}

// ── Nouvel ordre → broadcast livreurs disponibles + admins ───────────────────
export async function emitNewOrder(delivery, initialMessage) {
  if (!io) return;
  const payload = {
    deliveryId:      delivery.id,
    clientAlias:     delivery.alias,
    createdAt:       delivery.created_at,
    broadcastAt:     delivery.last_broadcast_at,
    pickupAddress:   delivery.pickup_address  ?? null,
    dropoffAddress:  delivery.dropoff_address ?? null,
    price:           delivery.price           ?? null,
    message: {
      type:    initialMessage.type,
      content: initialMessage.content,
      meta:    initialMessage.meta,
    },
  };

  // N'envoyer qu'aux drivers disponibles qui n'ont pas refusé cette course
  const refusedDriverIds = await db('delivery_refusals')
    .where('delivery_id', delivery.id)
    .pluck('driver_id');

  const availableDrivers = await db('drivers')
    .where({ is_available: true, suspended: false })
    .whereNotIn('id', refusedDriverIds.length ? refusedDriverIds : [-1])
    .select('id');
  for (const { id } of availableDrivers) {
    io.to(`driver:${id}`).emit('new_order', payload);
  }
  io.to(ADMINS_ROOM).emit('new_order', payload);
}

// ── Ordre pris → retirer de la file + notifier client ────────────────────────
export function emitOrderTaken(deliveryId) {
  if (!io) return;
  io.to(DRIVERS_ROOM).emit('order_taken', { deliveryId });
  io.to(ADMINS_ROOM).emit('order_taken', { deliveryId });
}

// ── Course acceptée → notifier le client ─────────────────────────────────────
export function emitOrderAssigned(deliveryId) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('order_assigned', { deliveryId });
}

// ── Message client → livreur (socket) ────────────────────────────────────────
export function emitClientMessage(deliveryId, message) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('client_message', {
    id:         message.id,
    senderRole: 'client',
    type:       message.type,
    content:    message.content,
    meta:       message.meta,
    createdAt:  message.created_at,
  });
}

// ── Message driver → client (socket) ─────────────────────────────────────────
export function emitDriverMessage(deliveryId, message) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('driver_message', {
    id:         message.id,
    senderRole: 'driver',
    type:       message.type,
    content:    message.content,
    meta:       message.meta,
    createdAt:  message.created_at,
  });
}

// ── Annulation livraison ──────────────────────────────────────────────────────
export function emitDeliveryCancelled(deliveryId) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('delivery_cancelled', { deliveryId });
}

// ── Appel entrant → admin ─────────────────────────────────────────────────────
export function emitIncomingCall(callInfo) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('incoming_call', callInfo);
}

// ── Message texte WA → admin call center ─────────────────────────────────────
export function emitIncomingText(delivery, message, clientAlias) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('incoming_text', {
    deliveryId:  delivery.id,
    clientAlias: clientAlias ?? delivery.alias,
    message: {
      id:        message.id,
      type:      message.type,
      content:   message.content,
      meta:      message.meta,
      createdAt: message.created_at,
    },
  });
}

export async function emitNewDelivery(delivery) {
  await emitNewOrder(delivery, { type: 'text', content: delivery.description, meta: null });
}

// ── CC → Livreur (message direct) ────────────────────────────────────────────
export function emitCCMessageToDriver(driverId, message) {
  if (!io) return;
  io.to(`driver:${driverId}`).emit('cc_message', message);
}

// ── Livreur → CC (réponse) ────────────────────────────────────────────────────
export function emitDriverReplyToCC(driverId, driverName, message) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('driver_reply_to_cc', { driverId, driverName, message });
}

// ── Disponibilité livreur → admins ───────────────────────────────────────────
export function emitDriverAvailability(driverId, driverName, isAvailable) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('driver_availability', { driverId, name: driverName, isAvailable });
}

// ── Conversation CC claimée par un agent → retirer des autres inboxes ─────────
export function emitConversationClaimed(deliveryId, adminId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('conversation_claimed', { deliveryId, claimedBy: adminId });
}

// ── Conversation CC libérée → peut réapparaître dans les inboxes ──────────────
export function emitConversationUnclaimed(deliveryId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('conversation_unclaimed', { deliveryId });
}

// ── Tous les livreurs disponibles ont refusé une course → notif admin ─────────
export function emitAllDriversRefused(deliveryId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('all_drivers_refused', { deliveryId });
}
