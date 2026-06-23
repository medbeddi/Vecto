import { Router } from 'express';
import db from '../config/db.js';
import { requireClientAuth } from '../middleware/client-auth.js';

const router = Router();

// GET /sim/conversation
// Retourne la livraison en cours + les messages du client authentifié
router.get('/conversation', requireClientAuth, async (req, res) => {
  try {
    const client = await db('clients').where({ id: req.client.id }).first('id', 'alias');
    if (!client) return res.json({ client: null, delivery: null, messages: [] });

    const delivery = await db('deliveries')
      .where({ client_id: client.id })
      .whereNotIn('status', ['done', 'cancelled'])
      .orderBy('created_at', 'desc')
      .first();

    const messages = delivery
      ? await db('messages')
          .where({ delivery_id: delivery.id })
          .orderBy('created_at', 'asc')
          .select('id', 'sender_role', 'type', 'content', 'meta', 'created_at as createdAt')
      : [];

    res.json({
      client: { id: client.id, alias: client.alias },
      delivery: delivery
        ? { id: delivery.id, status: delivery.status, description: delivery.description }
        : null,
      messages,
    });
  } catch (err) {
    console.error('[sim] erreur conversation:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
