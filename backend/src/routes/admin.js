import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { emitNewOrder } from '../services/socket.js';
import { createDelivery } from '../services/delivery.js';
import { hashWaId, encryptWaId } from '../services/pii-filter.js';

const router = Router();

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN' });
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

// ── Login admin ──────────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await db('admins').where({ email }).first();
    const valid = await bcrypt.compare(
      password,
      admin?.password_hash ?? '$2b$12$invalidhashpadding000000000000000000000000000000000000000'
    );
    if (!admin || !valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    const token = jwt.sign(
      { id: admin.id, name: admin.name, role: 'admin' },
      env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, admin: { id: admin.id, name: admin.name } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Dashboard : ordres actifs ────────────────────────────────────────────────
router.get('/admin/orders/active', requireAdmin, async (req, res) => {
  try {
    const orders = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .whereNull('deliveries.archived_at')
      .orderBy('deliveries.created_at', 'desc')
      .select(
        'deliveries.id', 'deliveries.status', 'deliveries.created_at as createdAt',
        'deliveries.initial_media_url as initialMediaUrl',
        'deliveries.initial_media_type as initialMediaType',
        'clients.alias as clientAlias'
      );
    res.json({ orders });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Archives ─────────────────────────────────────────────────────────────────
router.get('/admin/archives', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page ?? '1', 10);
    const limit = 20;
    const offset = (page - 1) * limit;

    const archives = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .leftJoin('drivers', 'deliveries.driver_id', 'drivers.id')
      .whereNotNull('deliveries.archived_at')
      .orderBy('deliveries.archived_at', 'desc')
      .limit(limit).offset(offset)
      .select(
        'deliveries.id', 'deliveries.status',
        'deliveries.created_at as createdAt',
        'deliveries.archived_at as archivedAt',
        'clients.alias as clientAlias',
        'drivers.name as driverName'
      );
    res.json({ archives });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Messages d'une archive ────────────────────────────────────────────────────
router.get('/admin/archives/:id/messages', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('deliveries').where({ id: req.params.id }).first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const messages = await db('messages')
      .where({ delivery_id: req.params.id })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role', 'type', 'content', 'meta', 'created_at as createdAt');

    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Broadcast depuis appel : admin crée un ordre et l'envoie à tous les livreurs
router.post('/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    const { description, mediaUrl, mediaType } = req.body;

    // Créer un client virtuel pour cet appel
    const callAlias = `Appel #${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const fakeHash = hashWaId(`admin_call_${Date.now()}`);
    const fakeEnc = encryptWaId(`admin_call_${Date.now()}`);

    const [client] = await db('clients')
      .insert({ wa_id_hash: fakeHash, wa_id_enc: fakeEnc, alias: callAlias })
      .returning('*');

    const [delivery] = await db('deliveries')
      .insert({
        client_id: client.id,
        status: 'pending',
        description,
        initial_media_url: mediaUrl ?? null,
        initial_media_type: mediaType ?? 'text',
      })
      .returning('*');

    const initialMessage = {
      type: mediaType ?? 'text',
      content: mediaUrl ?? description,
      meta: null,
    };

    emitNewOrder({ ...delivery, alias: callAlias }, initialMessage);

    res.json({ delivery: { id: delivery.id, clientAlias: callAlias } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
