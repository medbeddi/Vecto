import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { emitNewOrder, emitCCMessageToDriver, emitDriverReplyToCC } from '../services/socket.js';
import { createDelivery, launchDelivery } from '../services/delivery.js';
import { hashWaId, encryptWaId, decryptWaId } from '../services/pii-filter.js';
import { sendText, sendAudio } from '../services/messaging.js';

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

function requireCallCenter(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'call_center') return res.status(403).json({ error: 'FORBIDDEN' });
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

// ── Config publique (clés front-end) ─────────────────────────────────────────
router.get('/admin/config', (_req, res) => {
  res.json({ googleMapsKey: env.GOOGLE_MAPS_KEY });
});

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

    const adminRole = admin.role || 'admin';
    const token = jwt.sign(
      { id: admin.id, name: admin.name, role: adminRole },
      env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, admin: { id: admin.id, name: admin.name, role: adminRole } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Profil courant (vérification token) ──────────────────────────────────────
router.get('/admin/me', requireCallCenter, async (req, res) => {
  res.json({ id: req.admin.id, name: req.admin.name, role: req.admin.role });
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

// ── Stats KPIs ───────────────────────────────────────────────────────────────
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [coursesToday] = await db('deliveries')
      .where('created_at', '>=', today)
      .count('id as count');

    const [activeDrivers] = await db('drivers')
      .whereIn('status', ['available', 'busy'])
      .where('suspended', false)
      .count('id as count');

    const [totalClients] = await db('clients').count('id as count');

    const revenueRow = await db('wallet_transactions')
      .where('type', 'commission')
      .where('status', 'completed')
      .sum('amount as total')
      .first();

    // Courbes 7 derniers jours
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyRaw = await db('deliveries')
      .where('created_at', '>=', sevenDaysAgo)
      .groupByRaw("DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')")
      .orderByRaw("DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')")
      .select(
        db.raw("DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') as day"),
        db.raw('COUNT(*) as count')
      );

    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dayStr = d.toISOString().slice(0, 10);
      const found = dailyRaw.find(r => new Date(r.day).toISOString().slice(0, 10) === dayStr);
      daily.push({
        label: d.toLocaleDateString('fr-FR', { weekday: 'short' }),
        count: found ? parseInt(found.count, 10) : 0,
      });
    }

    res.json({
      coursesToday: parseInt(coursesToday.count, 10),
      activeDrivers: parseInt(activeDrivers.count, 10),
      totalClients: parseInt(totalClients.count, 10),
      totalRevenue: parseFloat(revenueRow?.total ?? 0),
      daily,
    });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Livreurs ─────────────────────────────────────────────────────────────────
router.get('/admin/drivers', requireCallCenter, async (req, res) => {
  try {
    const drivers = await db('drivers')
      .leftJoin('wallets', 'drivers.id', 'wallets.driver_id')
      .orderBy('drivers.created_at', 'desc')
      .select(
        'drivers.id', 'drivers.name', 'drivers.status', 'drivers.suspended',
        'drivers.created_at as createdAt',
        db.raw('COALESCE(wallets.balance, 0) as balance')
      );

    const counts = await db('deliveries')
      .whereIn('status', ['done'])
      .whereNotNull('driver_id')
      .groupBy('driver_id')
      .select('driver_id', db.raw('COUNT(*) as total'));

    const countMap = {};
    for (const c of counts) countMap[c.driver_id] = parseInt(c.total, 10);

    const result = drivers.map(d => ({
      id: d.id,
      name: d.name,
      status: d.suspended ? 'suspended' : d.status,
      courses: countMap[d.id] ?? 0,
      balance: parseFloat(d.balance),
      createdAt: d.createdAt,
    }));

    res.json({ drivers: result });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.put('/admin/drivers/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'NAME_REQUIRED' });
    await db('drivers').where({ id: req.params.id }).update({ name: name.trim() });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/admin/drivers/:id/suspend', requireAdmin, async (req, res) => {
  try {
    await db('drivers').where({ id: req.params.id }).update({ suspended: true, status: 'offline' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/admin/drivers/:id/reactivate', requireAdmin, async (req, res) => {
  try {
    await db('drivers').where({ id: req.params.id }).update({ suspended: false });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Clients ───────────────────────────────────────────────────────────────────
router.get('/admin/clients', requireCallCenter, async (req, res) => {
  try {
    const clients = await db('clients')
      .orderBy('clients.created_at', 'desc')
      .select('clients.id', 'clients.alias', 'clients.wa_id_enc', 'clients.created_at as createdAt');

    const counts = await db('deliveries')
      .whereNotNull('client_id')
      .groupBy('client_id')
      .select('client_id', db.raw('COUNT(*) as total'), db.raw('MAX(created_at) as lastAt'));

    const countMap = {};
    for (const c of counts) countMap[c.client_id] = { total: parseInt(c.total, 10), lastAt: c.lastAt };

    const result = clients.map((c, idx) => {
      let phone = null;
      try {
        const raw = decryptWaId(c.wa_id_enc);
        // Clients WA réels : wa_id est le numéro de téléphone (ex: 22244123456)
        // Clients admin (broadcast) : commence par "admin_call_"
        phone = raw.startsWith('admin_call_') ? null : raw;
      } catch {}

      return {
        num: idx + 1,
        id: c.id,
        alias: c.alias,
        phone,
        commandes: countMap[c.id]?.total ?? 0,
        derniere: countMap[c.id]?.lastAt ?? null,
        createdAt: c.createdAt,
      };
    });

    res.json({ clients: result });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Transactions wallet ───────────────────────────────────────────────────────
router.get('/admin/transactions', requireAdmin, async (req, res) => {
  try {
    const transactions = await db('wallet_transactions')
      .join('wallets', 'wallet_transactions.wallet_id', 'wallets.id')
      .join('drivers', 'wallets.driver_id', 'drivers.id')
      .orderBy('wallet_transactions.created_at', 'desc')
      .limit(100)
      .select(
        'wallet_transactions.id',
        'wallet_transactions.amount',
        'wallet_transactions.type',
        'wallet_transactions.description',
        'wallet_transactions.status',
        'wallet_transactions.created_at as createdAt',
        'drivers.name as driverName'
      );

    res.json({ transactions });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : liste des conversations en attente (admin_queue) ────────────
router.get('/admin/inbox', requireCallCenter, async (req, res) => {
  try {
    const rows = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.status', 'admin_queue')
      .whereNull('deliveries.archived_at')
      .orderBy('deliveries.created_at', 'desc')
      .select(
        'deliveries.id',
        'deliveries.created_at as createdAt',
        'clients.alias as clientAlias',
        'clients.wa_id_enc as waIdEnc'
      );

    const result = await Promise.all(rows.map(async (row) => {
      const last = await db('messages')
        .where({ delivery_id: row.id })
        .orderBy('created_at', 'desc')
        .first();
      return {
        id:          row.id,
        clientAlias: row.clientAlias,
        createdAt:   row.createdAt,
        lastMessage: last ? { type: last.type, content: last.content, createdAt: last.created_at } : null,
      };
    }));

    res.json({ inbox: result });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : messages d'une conversation admin_queue ─────────────────────
router.get('/admin/inbox/:id/messages', requireCallCenter, async (req, res) => {
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

// ── Call Center : répondre au client (via WhatsApp) ───────────────────────────
router.post('/admin/inbox/:id/reply', requireCallCenter, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'TEXT_REQUIRED' });

    const delivery = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('deliveries.*', 'clients.wa_id_enc as waIdEnc', 'clients.alias as clientAlias')
      .first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const rawWaId = decryptWaId(delivery.waIdEnc);

    // Sauvegarder le message admin
    const [message] = await db('messages')
      .insert({ delivery_id: req.params.id, sender_role: 'admin', type: 'text', content: text.trim(), meta: null })
      .returning('*');

    // Envoyer via WhatsApp
    await sendText(rawWaId, text.trim()).catch((err) => {
      console.error('[admin/reply] WhatsApp erreur:', err.message);
    });

    res.json({ message: { id: message.id, content: message.content, createdAt: message.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : réponse vocale admin → client WhatsApp ─────────────────────
router.post('/admin/inbox/:id/reply-audio', requireCallCenter, async (req, res) => {
  try {
    const { audioUrl } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'AUDIO_URL_REQUIRED' });

    const delivery = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('deliveries.*', 'clients.wa_id_enc as waIdEnc')
      .first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const rawWaId = decryptWaId(delivery.waIdEnc);

    const [message] = await db('messages')
      .insert({ delivery_id: req.params.id, sender_role: 'admin', type: 'audio', content: audioUrl, meta: null })
      .returning('*');

    await sendAudio(rawWaId, audioUrl).catch((err) => {
      console.error('[admin/reply-audio] WhatsApp erreur:', err.message);
    });

    res.json({ message: { id: message.id, content: message.content, createdAt: message.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : lancer une course (admin_queue → pending → livreurs) ─────────
router.post('/admin/inbox/:id/launch', requireCallCenter, async (req, res) => {
  try {
    const { pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price, forwardedAudioUrl } = req.body;

    const client = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('clients.alias as clientAlias')
      .first();
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });

    const updated = await launchDelivery(req.params.id, {
      pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price,
      forwardedAudioUrl,
    });

    // Dernier message pour l'affichage côté livreur
    const lastMsg = await db('messages')
      .where({ delivery_id: req.params.id })
      .orderBy('created_at', 'desc')
      .first();

    // Vocal transféré prioritaire, sinon dernier message, sinon texte par défaut
    const initialMessage = forwardedAudioUrl
      ? { type: 'audio', content: forwardedAudioUrl, meta: null }
      : lastMsg
        ? { type: lastMsg.type, content: lastMsg.content, meta: lastMsg.meta }
        : { type: 'text', content: pickupAddress ? `${pickupAddress} → ${dropoffAddress}` : 'Commande appel', meta: null };

    emitNewOrder({ ...updated, alias: client.clientAlias }, initialMessage);

    res.json({ delivery: { id: updated.id, status: updated.status } });
  } catch (err) {
    if (err.code === 'DELIVERY_NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
    if (err.code === 'INVALID_STATUS')     return res.status(409).json({ error: 'INVALID_STATUS' });
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Tracking : positions GPS des livreurs ─────────────────────────────────────
router.get('/admin/drivers/locations', requireAdmin, async (req, res) => {
  try {
    const drivers = await db('drivers')
      .whereNotNull('last_lat')
      .whereNotNull('last_lng')
      .where('suspended', false)
      .select('id', 'name', 'status', 'last_lat', 'last_lng', 'last_seen');

    res.json({
      drivers: drivers.map((d) => ({
        id: d.id, name: d.name, status: d.status,
        lat: d.last_lat, lng: d.last_lng, lastSeen: d.last_seen,
      })),
    });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Broadcast depuis appel : admin crée un ordre et l'envoie à tous les livreurs
router.post('/admin/broadcast', requireCallCenter, async (req, res) => {
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

// ── Gestion des utilisateurs admin / call center ──────────────────────────────
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db('admins as u')
      .leftJoin('admins as c', 'u.created_by', 'c.id')
      .orderBy('u.created_at', 'asc')
      .select(
        'u.id', 'u.name', 'u.email', 'u.role',
        'u.created_at as createdAt',
        'c.name as createdByName'
      );
    res.json({ users });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    if (!['admin', 'call_center'].includes(role)) {
      return res.status(400).json({ error: 'INVALID_ROLE' });
    }
    const exists = await db('admins').where({ email: email.trim().toLowerCase() }).first();
    if (exists) return res.status(409).json({ error: 'EMAIL_TAKEN' });

    const password_hash = await bcrypt.hash(password, 12);
    const [user] = await db('admins')
      .insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password_hash,
        role,
        created_by: req.admin.id,
      })
      .returning(['id', 'name', 'email', 'role', 'created_at']);
    res.json({ user: { ...user, createdAt: user.created_at, createdByName: req.admin.name } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
    }
    const deleted = await db('admins').where({ id: req.params.id }).delete();
    if (!deleted) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Chat CC ↔ Livreur ─────────────────────────────────────────────────────────

router.get('/admin/driver-chat/:driverId', requireCallCenter, async (req, res) => {
  try {
    const messages = await db('cc_driver_messages')
      .where({ driver_id: req.params.driverId })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role as senderRole', 'content', 'created_at as createdAt');
    await db('cc_driver_messages')
      .where({ driver_id: req.params.driverId, read_by_admin: false })
      .update({ read_by_admin: true });
    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/admin/driver-chat/:driverId', requireCallCenter, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    const driver = await db('drivers').where({ id: req.params.driverId }).first('id', 'name');
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    const [msg] = await db('cc_driver_messages')
      .insert({ driver_id: req.params.driverId, sender_role: 'admin', content: content.trim() })
      .returning('id', 'sender_role', 'content', 'created_at');
    emitCCMessageToDriver(req.params.driverId, {
      id: msg.id, senderRole: msg.sender_role, content: msg.content, createdAt: msg.created_at,
    });
    res.json({ message: { id: msg.id, senderRole: msg.sender_role, content: msg.content, createdAt: msg.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
