import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { relayDriverMessage } from './relay.js';
import db from '../config/db.js';
import { notifyAvailableDrivers, notifyAssignedDriver, notifyDriverList } from './fcm.js';
import { decryptWaId } from './pii-filter.js';
import { processQueue, releaseAndReassign } from './autoAssignment.js';

const NEARBY_KM       = 5;
const NEARBY_DELAY_MS = 60_000;

let io = null;
const DRIVERS_ROOM = 'room:drivers';
const ADMINS_ROOM  = 'room:admins';

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
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
    // ── Admin / Call-center agent ─────────────────────────────────────────────
    if (socket.data.admin) {
      const adminId = socket.data.admin.id;
      socket.join(ADMINS_ROOM);
      socket.join(`admin:${adminId}`); // Personal room for assignment notifications

      // Mark agent online in DB
      db('admins').where({ id: adminId }).update({ status: 'online' }).catch(() => {});

      // Push current driver locations to this newly connected agent
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

      // Drain any unassigned queue — this agent can absorb waiting conversations
      processQueue(notifyAssignment).catch(() => {});

      // Agent toggles their own availability (online ↔ break)
      socket.on('set_agent_status', async ({ status }) => {
        if (!['online', 'break'].includes(status)) return;
        try {
          await db('admins').where({ id: adminId }).update({ status });
          io.to(ADMINS_ROOM).emit('agent_status_changed', { adminId, status });
          if (status === 'online') {
            processQueue(notifyAssignment).catch(() => {});
          }
        } catch {}
      });

      socket.on('disconnect', async () => {
        try {
          await db('admins').where({ id: adminId }).update({ status: 'offline' });
          io.to(ADMINS_ROOM).emit('agent_status_changed', { adminId, status: 'offline' });

          // Release and immediately try to redistribute to remaining online agents
          const releasedIds = await releaseAndReassign(adminId, notifyAssignment);

          // Any conversation that still has no agent goes back into the visible queue
          for (const id of releasedIds) {
            const still = await db('deliveries')
              .where({ id, status: 'admin_queue' })
              .whereNull('claimed_by')
              .first('id');
            if (still) io.to(ADMINS_ROOM).emit('conversation_unclaimed', { deliveryId: id });
          }
        } catch {}
      });

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

/**
 * Notify the assigned agent of their new conversation, and remove it from
 * all other agents' queue views via the existing conversation_claimed event.
 * Exported so webhooks and routes can call it directly after an assignment.
 */
export async function notifyAssignment({ agentId, agentName, delivery }) {
  if (!io) return;

  const client = await db('clients')
    .where({ id: delivery.client_id })
    .first('alias', 'wa_id_enc');

  const lastMessage = await db('messages')
    .where({ delivery_id: delivery.id })
    .orderBy('created_at', 'desc')
    .first('id', 'type', 'content', 'meta', 'created_at');

  let clientPhone = null;
  try { clientPhone = decryptWaId(client.wa_id_enc); } catch {}

  const payload = {
    deliveryId:  delivery.id,
    clientAlias: client?.alias,
    clientPhone,
    createdAt:   delivery.created_at,
    claimedBy:   agentId,
    lastMessage: lastMessage
      ? { type: lastMessage.type, content: lastMessage.content, meta: lastMessage.meta, createdAt: lastMessage.created_at }
      : null,
  };

  // Push conversation directly into the agent's personal inbox
  io.to(`admin:${agentId}`).emit('conversation_assigned', payload);

  // Signal all agents to remove it from their shared queue view
  io.to(ADMINS_ROOM).emit('conversation_claimed', { deliveryId: delivery.id, claimedBy: agentId });
}

// ── Nouvel ordre → broadcast livreurs disponibles + admins ───────────────────
export async function emitNewOrder(delivery, initialMessage, { useProximity = true } = {}) {
  if (!io) return;
  const payload = {
    deliveryId:      delivery.id,
    clientAlias:     delivery.alias,
    createdAt:       delivery.created_at,
    broadcastAt:     delivery.last_broadcast_at,
    pickupAddress:   delivery.pickup_address  ?? null,
    dropoffAddress:  delivery.dropoff_address ?? null,
    price:           delivery.price           ?? null,
    status:          delivery.status          ?? 'pending',
    message: {
      type:    initialMessage.type,
      content: initialMessage.content,
      meta:    initialMessage.meta,
    },
  };

  const refusedDriverIds = await db('delivery_refusals')
    .where('delivery_id', delivery.id)
    .pluck('driver_id');
  const excludeIds = refusedDriverIds.length ? refusedDriverIds : [null];

  if (useProximity && delivery.pickup_lat != null && delivery.pickup_lng != null) {
    const nearbyDrivers = await db('drivers')
      .where({ is_available: true, suspended: false })
      .whereNotNull('last_lat').whereNotNull('last_lng')
      .whereNotIn('id', excludeIds)
      .whereRaw(
        `(6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(?)) * cos(radians(last_lat)) *
          cos(radians(last_lng) - radians(?)) +
          sin(radians(?)) * sin(radians(last_lat))
        )))) <= ?`,
        [delivery.pickup_lat, delivery.pickup_lng, delivery.pickup_lat, NEARBY_KM]
      )
      .select('id');

    if (nearbyDrivers.length > 0) {
      const nearbyIds = nearbyDrivers.map(d => d.id);

      for (const { id } of nearbyDrivers) {
        io.to(`driver:${id}`).emit('new_order', payload);
      }
      io.to(ADMINS_ROOM).emit('new_order', payload);

      notifyDriverList(nearbyIds, delivery).catch(() => {});

      setTimeout(async () => {
        try {
          const current = await db('deliveries').where({ id: delivery.id }).first('status');
          if (!current || current.status !== 'pending') return;

          await db('deliveries')
            .where({ id: delivery.id, status: 'pending' })
            .update({ last_broadcast_at: db.fn.now() });

          const freshRefused = await db('delivery_refusals')
            .where('delivery_id', delivery.id)
            .pluck('driver_id');

          const allExclude = [...nearbyIds, ...(freshRefused.length ? freshRefused : [null])];

          const farDrivers = await db('drivers')
            .where({ is_available: true, suspended: false })
            .whereNotIn('id', allExclude)
            .select('id');

          const updatedPayload = { ...payload, broadcastAt: new Date().toISOString() };
          for (const { id } of farDrivers) {
            io.to(`driver:${id}`).emit('new_order', updatedPayload);
          }

          const fcmExclude = [...nearbyIds, ...freshRefused];
          notifyAvailableDrivers(delivery, fcmExclude.length ? fcmExclude : []).catch(() => {});
        } catch {}
      }, NEARBY_DELAY_MS);

      return;
    }
  }

  const availableDrivers = await db('drivers')
    .where({ is_available: true, suspended: false })
    .whereNotIn('id', excludeIds)
    .select('id');
  for (const { id } of availableDrivers) {
    io.to(`driver:${id}`).emit('new_order', payload);
  }
  io.to(ADMINS_ROOM).emit('new_order', payload);

  notifyAvailableDrivers(delivery, refusedDriverIds).catch(() => {});
}

export function emitOrderTaken(deliveryId) {
  if (!io) return;
  io.to(DRIVERS_ROOM).emit('order_taken', { deliveryId });
  io.to(ADMINS_ROOM).emit('order_taken', { deliveryId });
}

export function emitOrderAssigned(deliveryId) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('order_assigned', { deliveryId });
}

export function emitClientMessage(deliveryId, message, driverId) {
  if (!io) return;
  const payload = {
    id:         message.id,
    senderRole: 'client',
    type:       message.type,
    content:    message.content,
    meta:       message.meta,
    createdAt:  message.created_at,
  };
  io.to(`course_${deliveryId}`).emit('client_message', payload);
  if (driverId) {
    io.to(`driver:${driverId}`).emit('client_message', payload);
  }
}

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

export function emitDeliveryCancelled(deliveryId) {
  if (!io) return;
  io.to(`course_${deliveryId}`).emit('delivery_cancelled', { deliveryId });
}

export function emitIncomingCall(callInfo) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('incoming_call', callInfo);
}

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

export function emitCCMessageToDriver(driverId, message) {
  if (!io) return;
  io.to(`driver:${driverId}`).emit('cc_message', message);
}

export function emitDriverReplyToCC(driverId, driverName, message) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('driver_reply_to_cc', { driverId, driverName, message });
}

export function emitDriverAvailability(driverId, driverName, isAvailable) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('driver_availability', { driverId, name: driverName, isAvailable });
}

export function emitConversationClaimed(deliveryId, adminId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('conversation_claimed', { deliveryId, claimedBy: adminId });
}

export function emitConversationUnclaimed(deliveryId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('conversation_unclaimed', { deliveryId });
}

export function emitAllDriversRefused(deliveryId) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('all_drivers_refused', { deliveryId });
}

export function emitMessageReaction(deliveryId, messageId, reactions) {
  if (!io) return;
  const payload = { deliveryId, messageId, reactions };
  io.to(ADMINS_ROOM).emit('message_reaction', payload);
  io.to(`course_${deliveryId}`).emit('message_reaction', payload);
}

export function emitAdminUpdate(type, data) {
  if (!io) return;
  io.to(ADMINS_ROOM).emit('admin_update', { type, ...data });
}
