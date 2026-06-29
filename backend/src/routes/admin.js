import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { emitNewOrder, emitCCMessageToDriver, emitDriverReplyToCC, emitConversationClaimed, emitConversationUnclaimed, emitDeliveryCancelled } from '../services/socket.js';
import { createDelivery, launchDelivery } from '../services/delivery.js';
import { hashWaId, encryptWaId, decryptWaId } from '../services/pii-filter.js';
import { sendText, sendAudio, sendImage, sendLocation } from '../services/messaging.js';
import { sendStatusMessageToClient } from '../services/relay.js';

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

// ── Config (clés front-end) ───────────────────────────────────────────────────
router.get('/admin/config', requireCallCenter, (_req, res) => {
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
      .whereIn('deliveries.status', ['pending', 'assigned', 'in_progress'])
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

// ── Annuler une commande (admin/CC) ──────────────────────────────────────────
router.patch('/admin/orders/:id/cancel', requireCallCenter, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ id: req.params.id })
      .first('id', 'status', 'driver_id', 'client_id');
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!['admin_queue', 'pending', 'assigned', 'in_progress'].includes(delivery.status)) {
      return res.status(409).json({ error: 'CANNOT_CANCEL' });
    }

    await db('deliveries').where({ id: req.params.id }).update({
      status: 'cancelled',
      archived_at: db.fn.now(),
      driver_id: null,
    });

    // Libérer le livreur s'il y en avait un
    if (delivery.driver_id) {
      await db('drivers').where({ id: delivery.driver_id }).update({ status: 'available' });
    }

    // Notifier le driver via socket (ferme le chat côté app)
    emitDeliveryCancelled(req.params.id);

    // Informer le client via WhatsApp
    sendStatusMessageToClient(req.params.id, 'Votre commande a été annulée ❌').catch(() => {});

    res.json({ ok: true });
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
    const delivery = await db('deliveries').where({ id: req.params.id }).whereNotNull('archived_at').first();
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

// POST /admin/drivers — créer un compte livreur depuis l'admin
router.post('/admin/drivers', requireAdmin, async (req, res) => {
  const { name, phone, password } = req.body;
  if (!name?.trim() || !phone?.trim() || !password || !/^\d{4}$/.test(password.trim())) {
    return res.status(400).json({ error: 'INVALID_BODY' });
  }
  try {
    const phoneHash = hashWaId(phone.trim());
    const existing = await db('drivers').where({ phone_hash: phoneHash }).first('id');
    if (existing) return res.status(409).json({ error: 'PHONE_ALREADY_USED' });
    const passwordHash = await bcrypt.hash(password, 12);
    const [driver] = await db('drivers')
      .insert({ name: name.trim(), phone: phone.trim(), phone_hash: phoneHash, password_hash: passwordHash, status: 'offline' })
      .returning(['id', 'name', 'phone', 'status', 'created_at as createdAt']);
    res.status(201).json({ driver: { ...driver, courses: 0, balance: 0 } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/admin/drivers', requireCallCenter, async (req, res) => {
  try {
    const drivers = await db('drivers')
      .leftJoin('wallets', 'drivers.id', 'wallets.driver_id')
      .orderBy('drivers.created_at', 'desc')
      .select(
        'drivers.id', 'drivers.name', 'drivers.phone', 'drivers.status', 'drivers.suspended',
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
      phone: d.phone || null,
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

// GET /admin/drivers/:id/documents — documents + infos du livreur
router.get('/admin/drivers/:id/documents', requireCallCenter, async (req, res) => {
  try {
    const driver = await db('drivers').where({ id: req.params.id }).first(
      'id', 'name', 'phone',
      'photo_driver', 'carte_grise_front', 'carte_grise_back',
      'carte_identite_front', 'carte_identite_back',
      'matricule', 'photo_vehicule'
    );
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    res.json({ driver });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PATCH /admin/drivers/:id/documents — mettre à jour documents + matricule
router.patch('/admin/drivers/:id/documents', requireAdmin, async (req, res) => {
  const allowed = [
    'photo_driver', 'carte_grise_front', 'carte_grise_back',
    'carte_identite_front', 'carte_identite_back', 'matricule', 'photo_vehicule',
  ];
  const update = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) update[field] = req.body[field];
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'NO_FIELDS' });
  try {
    const driver = await db('drivers').where({ id: req.params.id }).first('id');
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    await db('drivers').where({ id: req.params.id }).update(update);
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

router.patch('/admin/drivers/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || !/^\d{4}$/.test(password.trim())) return res.status(400).json({ error: 'PASSWORD_DIGITS_ONLY' });
    const driver = await db('drivers').where({ id: req.params.id }).first('id');
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    const hash = await bcrypt.hash(password.trim(), 12);
    await db('drivers').where({ id: req.params.id }).update({ password_hash: hash });
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

// ── Modifier le nom (alias) d'un client ──────────────────────────────────────
router.patch('/admin/clients/:id/alias', requireCallCenter, async (req, res) => {
  try {
    const { alias } = req.body;
    if (!alias?.trim()) return res.status(400).json({ error: 'ALIAS_REQUIRED' });
    const [client] = await db('clients')
      .where({ id: req.params.id })
      .update({ alias: alias.trim() })
      .returning('id', 'alias');
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ client });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Supprimer un client ───────────────────────────────────────────────────────
router.delete('/admin/clients/:id', requireCallCenter, async (req, res) => {
  try {
    const active = await db('deliveries')
      .where({ client_id: req.params.id })
      .whereIn('status', ['admin_queue', 'pending', 'assigned', 'in_progress'])
      .first('id');
    if (active) return res.status(409).json({ error: 'CLIENT_HAS_ACTIVE_DELIVERY' });

    const deliveryIds = await db('deliveries').where({ client_id: req.params.id }).pluck('id');
    if (deliveryIds.length) {
      await db('messages').whereIn('delivery_id', deliveryIds).delete();
      await db('deliveries').where({ client_id: req.params.id }).delete();
    }

    const deleted = await db('clients').where({ id: req.params.id }).delete();
    if (!deleted) return res.status(404).json({ error: 'NOT_FOUND' });

    res.json({ ok: true });
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

// Normalise un numéro de téléphone au format WhatsApp (chiffres uniquement, sans +)
function normalizePhone(raw) {
  return (raw || '').replace(/[\s\-().+]/g, '');
}

// ── Call Center : recherche client par numéro de téléphone ───────────────────
router.get('/admin/clients/search', requireCallCenter, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone?.trim()) return res.status(400).json({ error: 'PHONE_REQUIRED' });
    const hash = hashWaId(normalizePhone(phone));
    const client = await db('clients').where({ wa_id_hash: hash }).first('id', 'alias', 'wa_id_enc');
    if (!client) return res.json({ found: false });
    let decryptedPhone = null;
    try {
      const raw = decryptWaId(client.wa_id_enc);
      decryptedPhone = raw.startsWith('admin_call_') ? null : raw;
    } catch {}
    res.json({ found: true, client: { id: client.id, alias: client.alias, phone: decryptedPhone } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : créer une course depuis un appel téléphonique ───────────────
router.post('/admin/call-course', requireCallCenter, async (req, res) => {
  try {
    const { phone, pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price, description, audioUrl } = req.body;
    if (!pickupAddress?.trim() || !dropoffAddress?.trim()) {
      return res.status(400).json({ error: 'ADDRESSES_REQUIRED' });
    }

    let clientId, clientAlias;

    if (phone?.trim()) {
      const normalized = normalizePhone(phone);
      const hash = hashWaId(normalized);
      const existing = await db('clients').where({ wa_id_hash: hash }).first('id', 'alias');
      if (existing) {
        clientId    = existing.id;
        clientAlias = existing.alias;
      } else {
        // Nouveau client lié au numéro → WhatsApp relay + connexion app future possible
        clientAlias = `Client #${Math.random().toString(36).toUpperCase().slice(-5)}`;
        const [newClient] = await db('clients')
          .insert({ wa_id_hash: hash, wa_id_enc: encryptWaId(normalized), alias: clientAlias })
          .returning('*');
        clientId = newClient.id;
      }
    } else {
      clientAlias = `Appel #${Date.now().toString(36).toUpperCase().slice(-5)}`;
      const ts = `admin_call_${Date.now()}_${Math.random()}`;
      const [newClient] = await db('clients')
        .insert({ wa_id_hash: hashWaId(ts), wa_id_enc: encryptWaId(ts), alias: clientAlias })
        .returning('*');
      clientId = newClient.id;
    }

    const deliveryData = {
      client_id:         clientId,
      status:            'pending',
      pickup_address:    pickupAddress.trim(),
      dropoff_address:   dropoffAddress.trim(),
      pickup_lat:        pickupLat  ?? null,
      pickup_lng:        pickupLng  ?? null,
      dropoff_lat:       dropoffLat ?? null,
      dropoff_lng:       dropoffLng ?? null,
      price:             price      ?? null,
      description:       description?.trim() || `${pickupAddress.trim()} → ${dropoffAddress.trim()}`,
      initial_media_url:  audioUrl ?? null,
      initial_media_type: audioUrl ? 'audio' : null,
      last_broadcast_at: db.fn.now(),
    };

    // Livreur le plus proche du point de départ
    if (pickupLat != null && pickupLng != null) {
      const nearest = await db('drivers')
        .where({ is_available: true, suspended: false })
        .whereNotNull('last_lat').whereNotNull('last_lng')
        .select('id', db.raw(`
          (6371 * acos(
            cos(radians(?)) * cos(radians(last_lat)) *
            cos(radians(last_lng) - radians(?)) +
            sin(radians(?)) * sin(radians(last_lat))
          )) AS distance_km
        `, [pickupLat, pickupLng, pickupLat]))
        .orderBy('distance_km', 'asc')
        .first();
      if (nearest) {
        deliveryData.nearest_driver_id  = nearest.id;
        deliveryData.priority_expires_at = db.raw("NOW() + INTERVAL '1 minute'");
      }
    }

    const [delivery] = await db('deliveries').insert(deliveryData).returning('*');

    // Insérer le vocal CC en tant que message visible par le livreur dans le chat
    if (audioUrl) {
      await db('messages').insert({
        delivery_id: delivery.id,
        sender_role: 'admin',
        type: 'audio',
        content: audioUrl,
        meta: JSON.stringify({ for_driver: true }),
      });
    }

    emitNewOrder({ ...delivery, alias: clientAlias }, audioUrl
      ? { type: 'audio', content: audioUrl, meta: null }
      : { type: 'text', content: deliveryData.description, meta: null }
    ).catch(() => {});

    res.json({ delivery: { id: delivery.id, clientAlias } });
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
        'deliveries.claimed_by as claimedBy',
        'clients.alias as clientAlias',
        'clients.wa_id_enc as waIdEnc'
      );

    const result = await Promise.all(rows.map(async (row) => {
      const last = await db('messages')
        .where({ delivery_id: row.id })
        .orderBy('created_at', 'desc')
        .first();
      let clientPhone = null;
      try { clientPhone = decryptWaId(row.waIdEnc); } catch {}
      return {
        id:          row.id,
        clientAlias: row.clientAlias,
        clientPhone,
        createdAt:   row.createdAt,
        claimedBy:   row.claimedBy,
        lastMessage: last ? { type: last.type, content: last.content, createdAt: last.created_at } : null,
      };
    }));

    res.json({ inbox: result });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : réclamer (lock) une conversation ────────────────────────────
router.post('/admin/inbox/:id/claim', requireCallCenter, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const delivery = await db('deliveries')
      .where({ id: req.params.id, status: 'admin_queue' })
      .first('id', 'claimed_by');
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    // Déjà claimée par quelqu'un d'autre → refus
    if (delivery.claimed_by && delivery.claimed_by !== adminId) {
      return res.status(409).json({ error: 'ALREADY_CLAIMED' });
    }

    await db('deliveries')
      .where({ id: req.params.id })
      .update({ claimed_by: adminId, claimed_at: db.fn.now() });

    // Notifier les autres agents CC que cette conversation est prise
    emitConversationClaimed(req.params.id, adminId);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : libérer une conversation ────────────────────────────────────
router.post('/admin/inbox/:id/unclaim', requireCallCenter, async (req, res) => {
  try {
    await db('deliveries')
      .where({ id: req.params.id, claimed_by: req.admin.id })
      .update({ claimed_by: null, claimed_at: null });
    emitConversationUnclaimed(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : conversations archivées (livrées ou annulées) ───────────────
router.get('/admin/inbox/archived', requireCallCenter, async (req, res) => {
  try {
    const rows = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .whereIn('deliveries.status', ['done', 'cancelled'])
      .whereExists(
        db('messages').whereRaw('messages.delivery_id = deliveries.id')
      )
      .orderBy('deliveries.created_at', 'desc')
      .limit(50)
      .select(
        'deliveries.id',
        'deliveries.status',
        'deliveries.created_at as createdAt',
        'deliveries.done_at as doneAt',
        'clients.alias as clientAlias'
      );

    const result = await Promise.all(rows.map(async (row) => {
      const last = await db('messages')
        .where({ delivery_id: row.id })
        .orderBy('created_at', 'desc')
        .first();
      return {
        id:          row.id,
        status:      row.status,
        clientAlias: row.clientAlias,
        createdAt:   row.createdAt,
        doneAt:      row.doneAt,
        lastMessage: last ? { type: last.type, content: last.content, createdAt: last.created_at } : null,
      };
    }));

    res.json({ archived: result });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : messages d'une conversation admin_queue ─────────────────────
router.get('/admin/inbox/:id/messages', requireCallCenter, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ id: req.params.id })
      .whereIn('status', ['admin_queue', 'done', 'cancelled'])
      .first();
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

    // Envoyer via WhatsApp et stocker le wamid pour permettre les réactions
    try {
      const waResp = await sendText(rawWaId, text.trim());
      const waMsgId = waResp?.messages?.[0]?.id;
      if (waMsgId) {
        await db('messages').where({ id: message.id }).update({ meta: JSON.stringify({ waId: waMsgId }) });
      }
    } catch (err) {
      console.error('[admin/reply] WhatsApp erreur:', err.message);
    }

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

    try {
      const waResp = await sendAudio(rawWaId, audioUrl);
      const waMsgId = waResp?.messages?.[0]?.id;
      if (waMsgId) {
        await db('messages').where({ id: message.id }).update({ meta: JSON.stringify({ waId: waMsgId }) });
      }
    } catch (err) {
      console.error('[admin/reply-audio] WhatsApp erreur:', err.message);
    }

    res.json({ message: { id: message.id, content: message.content, createdAt: message.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : image admin → client WhatsApp ───────────────────────────────
router.post('/admin/inbox/:id/reply-image', requireCallCenter, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'IMAGE_URL_REQUIRED' });

    const delivery = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('deliveries.*', 'clients.wa_id_enc as waIdEnc')
      .first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const rawWaId = decryptWaId(delivery.waIdEnc);

    const [message] = await db('messages')
      .insert({ delivery_id: req.params.id, sender_role: 'admin', type: 'image', content: imageUrl, meta: null })
      .returning('*');

    try {
      const waResp = await sendImage(rawWaId, imageUrl);
      const waMsgId = waResp?.messages?.[0]?.id;
      if (waMsgId) {
        await db('messages').where({ id: message.id }).update({ meta: JSON.stringify({ waId: waMsgId }) });
      }
    } catch (err) {
      console.error('[admin/reply-image] WhatsApp erreur:', err.message);
    }

    res.json({ message: { id: message.id, content: message.content, createdAt: message.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : localisation admin → client WhatsApp ────────────────────────
router.post('/admin/inbox/:id/reply-location', requireCallCenter, async (req, res) => {
  try {
    const { lat, lng, label } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'LAT_LNG_REQUIRED' });

    const delivery = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('deliveries.*', 'clients.wa_id_enc as waIdEnc')
      .first();
    if (!delivery) return res.status(404).json({ error: 'NOT_FOUND' });

    const rawWaId = decryptWaId(delivery.waIdEnc);
    const locLabel = label || 'Position partagée';

    const [message] = await db('messages')
      .insert({ delivery_id: req.params.id, sender_role: 'admin', type: 'location', content: null, meta: { lat, lng, label: locLabel } })
      .returning('*');

    try {
      const waResp = await sendLocation(rawWaId, lat, lng, locLabel);
      const waMsgId = waResp?.messages?.[0]?.id;
      if (waMsgId) {
        await db('messages').where({ id: message.id }).update({ meta: JSON.stringify({ lat, lng, label: locLabel, waId: waMsgId }) });
      }
    } catch (err) {
      console.error('[admin/reply-location] WhatsApp erreur:', err.message);
    }

    res.json({ message: { id: message.id, meta: message.meta, createdAt: message.created_at } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Réaction emoji sur un message ─────────────────────────────────────────────
router.patch('/admin/messages/:id/react', requireCallCenter, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'EMOJI_REQUIRED' });

    const msg = await db('messages').where({ id: req.params.id }).first('id', 'meta');
    if (!msg) return res.status(404).json({ error: 'NOT_FOUND' });

    const reactions = { ...(msg.meta?.reactions || {}) };
    const users = reactions[emoji] || [];
    if (users.includes('admin')) {
      const next = users.filter((u) => u !== 'admin');
      if (next.length === 0) delete reactions[emoji]; else reactions[emoji] = next;
    } else {
      reactions[emoji] = [...users, 'admin'];
    }

    const newMeta = { ...(msg.meta || {}), reactions };
    await db('messages').where({ id: req.params.id }).update({ meta: JSON.stringify(newMeta) });
    res.json({ reactions });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Call Center : lancer une course (admin_queue → pending → livreurs) ─────────
router.post('/admin/inbox/:id/launch', requireCallCenter, async (req, res) => {
  try {
    const { pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price, description, forwardedAudioUrl } = req.body;

    const client = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.id', req.params.id)
      .select('clients.alias as clientAlias')
      .first();
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });

    const updated = await launchDelivery(req.params.id, {
      pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price, description,
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

    // Stocker le vocal transféré dans la DB (seulement si nouveau fichier audio, pas une copie d'un msg existant)
    if (forwardedAudioUrl) {
      await db('messages').insert({
        delivery_id: req.params.id,
        sender_role: 'admin',
        type: 'audio',
        content: forwardedAudioUrl,
        meta: { for_driver: true },
      });
    }

    emitNewOrder({ ...updated, alias: client.clientAlias }, initialMessage).catch((e) => {
      console.error('[launch] emitNewOrder failed:', e.message);
    });

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
      .select('id', 'name', 'status', 'is_available', 'last_lat', 'last_lng', 'last_seen');

    res.json({
      drivers: drivers.map((d) => ({
        id: d.id, name: d.name, status: d.status, isAvailable: d.is_available,
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

    await emitNewOrder({ ...delivery, alias: callAlias }, initialMessage);

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

router.patch('/admin/users/:id/password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    const hash = await bcrypt.hash(password, 12);
    const updated = await db('admins').where({ id: req.params.id }).update({ password_hash: hash });
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
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
      .select('id', 'sender_role as senderRole', 'type', 'content', 'meta', 'created_at as createdAt');
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
    const { content, type = 'text', meta } = req.body;
    const msgType = ['text', 'audio', 'image', 'location', 'call'].includes(type) ? type : 'text';
    if (msgType === 'location') {
      if (!meta?.lat || !meta?.lng) return res.status(400).json({ error: 'LOCATION_REQUIRED' });
    } else {
      if (!content?.trim()) return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    }
    const driver = await db('drivers').where({ id: req.params.driverId }).first('id', 'name');
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    const insertData = {
      driver_id: req.params.driverId,
      sender_role: 'admin',
      type: msgType,
      content: msgType === 'location' ? '' : content.trim(),
    };
    if (meta) insertData.meta = JSON.stringify(meta);
    const [msg] = await db('cc_driver_messages')
      .insert(insertData)
      .returning(['id', 'sender_role', 'type', 'content', 'meta', 'created_at']);
    const out = { id: msg.id, senderRole: msg.sender_role, type: msg.type, content: msg.content, meta: msg.meta, createdAt: msg.created_at };
    emitCCMessageToDriver(req.params.driverId, out);
    res.json({ message: out });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Réaction emoji sur un message driver chat ─────────────────────────────
router.patch('/admin/driver-chat-messages/:id/react', requireCallCenter, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'EMOJI_REQUIRED' });

    const msg = await db('cc_driver_messages').where({ id: req.params.id }).first('id', 'meta');
    if (!msg) return res.status(404).json({ error: 'NOT_FOUND' });

    const reactions = { ...(msg.meta?.reactions || {}) };
    const users = reactions[emoji] || [];
    if (users.includes('admin')) {
      const next = users.filter((u) => u !== 'admin');
      if (next.length === 0) delete reactions[emoji]; else reactions[emoji] = next;
    } else {
      reactions[emoji] = [...users, 'admin'];
    }

    const newMeta = { ...(msg.meta || {}), reactions };
    await db('cc_driver_messages').where({ id: req.params.id }).update({ meta: JSON.stringify(newMeta) });
    res.json({ reactions });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Upload fichier depuis le dashboard admin (vocal/image dans le chat livreur)
import multer from 'multer';
import { mkdirSync, readFileSync } from 'fs';
import pathMod from 'path';
import { fileURLToPath as fturl } from 'url';
import { uploadToR2, extFromMime } from '../services/media.js';

const __dirnameAdmin = pathMod.dirname(fturl(import.meta.url));
const ADMIN_UPLOADS_DIR = pathMod.join(__dirnameAdmin, '../../uploads');
mkdirSync(ADMIN_UPLOADS_DIR, { recursive: true });

const adminUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ADMIN_UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = pathMod.extname(file.originalname) || '.bin';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Type non supporté'));
  },
});

router.post('/admin/upload', requireCallCenter, adminUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
  if (env.R2_ENABLED && env.R2_PUBLIC_URL) {
    try {
      const ext = extFromMime(req.file.mimetype) || pathMod.extname(req.file.originalname).slice(1) || 'bin';
      const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = readFileSync(req.file.path);
      await uploadToR2(buffer, key, req.file.mimetype);
      return res.json({ url: `${env.R2_PUBLIC_URL}/${key}` });
    } catch (err) {
      console.error('[admin/upload] R2 failed, falling back to disk:', err.message);
    }
  }
  const base = env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
  res.json({ url: `${base}/uploads/${req.file.filename}` });
});

// ── Settings : tarification des courses ───────────────────────────
router.get('/admin/settings/tarif', requireAdmin, async (req, res) => {
  try {
    const rows = await db('app_settings')
      .whereIn('key', ['tarif_base_km', 'tarif_base_prix', 'tarif_par_km_supp', 'commission_pourcentage']);
    const s = {};
    rows.forEach((r) => { s[r.key] = parseFloat(r.value); });
    res.json({
      base_km:               s.tarif_base_km         ?? 3,
      base_prix:             s.tarif_base_prix        ?? 100,
      prix_par_km:           s.tarif_par_km_supp      ?? 20,
      commission_pourcentage: s.commission_pourcentage ?? 15,
    });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.put('/admin/settings/tarif', requireAdmin, async (req, res) => {
  try {
    const { base_km, base_prix, prix_par_km, commission_pourcentage } = req.body;
    if (
      typeof base_km !== 'number'               || base_km < 0 ||
      typeof base_prix !== 'number'             || base_prix < 0 ||
      typeof prix_par_km !== 'number'           || prix_par_km < 0 ||
      (commission_pourcentage !== undefined && (typeof commission_pourcentage !== 'number' || commission_pourcentage < 0 || commission_pourcentage > 100))
    ) return res.status(400).json({ error: 'INVALID_PARAMS' });

    const now = new Date();
    const rows = [
      { key: 'tarif_base_km',     value: String(base_km),     updated_at: now },
      { key: 'tarif_base_prix',   value: String(base_prix),   updated_at: now },
      { key: 'tarif_par_km_supp', value: String(prix_par_km), updated_at: now },
    ];
    if (commission_pourcentage !== undefined) {
      rows.push({ key: 'commission_pourcentage', value: String(commission_pourcentage), updated_at: now });
    }
    await db('app_settings')
      .insert(rows)
      .onConflict('key').merge(['value', 'updated_at']);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Settings : créneau de diffusion des courses ───────────────────
router.get('/admin/settings/creneau', requireAdmin, async (req, res) => {
  try {
    const rows = await db('app_settings').where('key', 'creneau_duree_min');
    const val = rows[0] ? parseInt(rows[0].value, 10) : 3;
    res.json({ duree_min: val });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.put('/admin/settings/creneau', requireAdmin, async (req, res) => {
  try {
    const { duree_min } = req.body;
    if (typeof duree_min !== 'number' || !Number.isInteger(duree_min) || duree_min < 1 || duree_min > 60) {
      return res.status(400).json({ error: 'INVALID_PARAMS' });
    }
    await db('app_settings')
      .insert({ key: 'creneau_duree_min', value: String(duree_min), updated_at: new Date() })
      .onConflict('key').merge(['value', 'updated_at']);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
