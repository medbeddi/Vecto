import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { relayDriverMessage } from './relay.js';

let io = null;
const DRIVERS_ROOM = 'room:drivers';
const ADMINS_ROOM  = 'room:admins';

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
  });

  // ── Namespace livreurs (/) ─────────────────────────────────────────────────
  io.use((socket, next) => {
    const raw = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization;
    const token = raw?.replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      if (decoded.role === 'admin') {
        socket.data.admin = decoded;
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
      console.info(`[socket] admin connecté id=${socket.data.admin.id} sid=${socket.id}`);
      socket.on('disconnect', () =>
        console.info(`[socket] admin déconnecté id=${socket.data.admin.id}`)
      );
      return;
    }

    // ── Livreur ──────────────────────────────────────────────────────────────
    const driverId = socket.data.driver?.id;
    console.info(`[socket] livreur connecté driverId=${driverId} sid=${socket.id}`);

    // Rejoindre la room broadcast de tous les livreurs
    socket.join(DRIVERS_ROOM);

    socket.on('join_room', ({ deliveryId }) => {
      if (!deliveryId) return;
      socket.join(`course_${deliveryId}`);
      console.info(`[socket] driverId=${driverId} a rejoint course_${deliveryId}`);
    });

    socket.on('driver_message', async ({ deliveryId, type, content, meta }) => {
      if (!driverId || !deliveryId) return;
      try {
        await relayDriverMessage(deliveryId, driverId, { type, content, meta });
      } catch (err) {
        socket.emit('relay_error', { deliveryId, code: err.code ?? 'RELAY_FAILED' });
      }
    });

    socket.on('disconnect', () =>
      console.info(`[socket] livreur déconnecté driverId=${driverId}`)
    );
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO non initialisé');
  return io;
}

// ── Nouvel ordre → broadcast à TOUS les livreurs actifs + admin ──────────────
export function emitNewOrder(delivery, initialMessage) {
  if (!io) return;
  const payload = {
    deliveryId:     delivery.id,
    clientAlias:    delivery.alias,
    createdAt:      delivery.created_at,
    message: {
      type:    initialMessage.type,
      content: initialMessage.content,
      meta:    initialMessage.meta,
    },
  };
  io.to(DRIVERS_ROOM).emit('new_order', payload);
  io.to(ADMINS_ROOM).emit('new_order', payload);
}

// ── Ordre pris → retirer de la file des autres livreurs ──────────────────────
export function emitOrderTaken(deliveryId) {
  if (!io) return;
  io.to(DRIVERS_ROOM).emit('order_taken', { deliveryId });
  io.to(ADMINS_ROOM).emit('order_taken', { deliveryId });
}

// ── Message client → livreur assigné ────────────────────────────────────────
export function emitClientMessage(deliveryId, message) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('client_message', {
    type: message.type, content: message.content,
    meta: message.meta, createdAt: message.created_at,
  });
}

// ── Annulation livraison ──────────────────────────────────────────────────────
export function emitDeliveryCancelled(deliveryId) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('delivery_cancelled', { deliveryId });
}

// ── Appel WhatsApp entrant → admin uniquement ─────────────────────────────────
export function emitIncomingCall(callInfo) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('incoming_call', callInfo);
}

// Compatibilité ancienne API
export function emitNewDelivery(delivery) { emitNewOrder(delivery, { type: 'text', content: delivery.description, meta: null }); }
