/**
 * Routes de simulation client — développement uniquement.
 * Permet de tester le scénario complet sans passer par Meta.
 */
import { Router } from 'express';
import db from '../config/db.js';
import { hashWaId } from '../services/pii-filter.js';

const router = Router();

// GET /sim/conversation?phone=+22234478444
// Retourne la livraison en cours + les messages pour un numéro client
router.get('/conversation', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requis' });

    const waHash = hashWaId(phone);
    const client = await db('clients').where({ wa_id_hash: waHash }).first();
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
