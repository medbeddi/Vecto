import { Router } from 'express';
import db from '../config/db.js';
import { requireClientAuth } from '../middleware/client-auth.js';
import { emitNewOrder, emitClientMessage } from '../services/socket.js';

const router = Router();

// ── Delivery active ───────────────────────────────────────────────────────────
router.get('/client/delivery/active', requireClientAuth, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ client_id: req.client.id })
      .whereNotIn('status', ['done', 'cancelled'])
      .orderBy('created_at', 'desc')
      .first();

    if (!delivery) return res.json({ delivery: null, messages: [] });

    const messages = await db('messages')
      .where({ delivery_id: delivery.id })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role as senderRole', 'type', 'content', 'meta', 'created_at as createdAt');

    res.json({ delivery: { id: delivery.id, status: delivery.status }, messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Créer une delivery avec premier message ───────────────────────────────────
router.post('/client/delivery', requireClientAuth, async (req, res) => {
  try {
    const { type, content, meta } = req.body;
    if (!type) return res.status(400).json({ error: 'MISSING_TYPE' });

    const existing = await db('deliveries')
      .where({ client_id: req.client.id })
      .whereNotIn('status', ['done', 'cancelled'])
      .first();

    if (existing) {
      return res.status(409).json({ error: 'DELIVERY_ALREADY_ACTIVE', deliveryId: existing.id });
    }

    const description = type === 'text' ? (content ?? null) : `[${type}]`;

    const [delivery] = await db('deliveries')
      .insert({ client_id: req.client.id, status: 'pending', description })
      .returning('*');

    const [message] = await db('messages')
      .insert({
        delivery_id: delivery.id,
        sender_role: 'client',
        type,
        content: type !== 'location' ? (content ?? null) : null,
        meta: meta ?? null,
      })
      .returning('*');

    // Mettre à jour la delivery avec le type du premier message
    await db('deliveries').where({ id: delivery.id }).update({
      initial_media_type: type,
      initial_media_url: type !== 'location' ? (content ?? null) : null,
    });

    emitNewOrder({ ...delivery, alias: req.client.alias }, {
      type: message.type,
      content: message.content,
      meta: message.meta,
    });

    res.json({ delivery: { id: delivery.id, status: delivery.status } });
  } catch (err) {
    console.error('[client] delivery create error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Messages d'une delivery ───────────────────────────────────────────────────
router.get('/client/delivery/:id/messages', requireClientAuth, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ id: req.params.id, client_id: req.client.id })
      .first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const messages = await db('messages')
      .where({ delivery_id: delivery.id })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role as senderRole', 'type', 'content', 'meta', 'created_at as createdAt');

    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Envoyer un message (client → driver) ─────────────────────────────────────
router.post('/client/delivery/:id/message', requireClientAuth, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ id: req.params.id, client_id: req.client.id })
      .whereIn('status', ['assigned', 'in_progress'])
      .first();

    if (!delivery) return res.status(404).json({ error: 'DELIVERY_NOT_FOUND' });

    const { type, content, meta } = req.body;

    const [message] = await db('messages')
      .insert({
        delivery_id: delivery.id,
        sender_role: 'client',
        type: type ?? 'text',
        content: type !== 'location' ? (content ?? null) : null,
        meta: meta ?? null,
      })
      .returning('*');

    emitClientMessage(delivery.id, message);

    res.json({
      message: {
        id: message.id,
        senderRole: 'client',
        type: message.type,
        content: message.content,
        meta: message.meta,
        createdAt: message.created_at,
      },
    });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
