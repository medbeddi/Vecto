import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginLimiter } from '../middleware/rate-limit.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  statusSchema,
  messageSchema,
  fcmTokenSchema,
  presignQuerySchema,
} from '../validation/schemas.js';
import { hashWaId } from '../services/pii-filter.js';
import { acceptDelivery, updateDeliveryStatus } from '../services/delivery.js';
import { relayDriverMessage } from '../services/relay.js';
import { getSignedUploadUrl } from '../services/media.js';
import { emitDeliveryCancelled, emitDriverReplyToCC, emitDriverAvailability } from '../services/socket.js';

const router = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────

// Vérifie si un numéro est déjà inscrit (sans révéler d'info sensible)
router.post('/auth/check', loginLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 6) return res.status(400).json({ error: 'INVALID_PHONE' });
    const phoneHash = hashWaId(phone.trim());
    const driver = await db('drivers').where({ phone_hash: phoneHash }).first('id');
    res.json({ exists: !!driver });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/auth/register', loginLimiter, validate(registerSchema), async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const phoneHash = hashWaId(phone);

    const existing = await db('drivers').where({ phone_hash: phoneHash }).first();
    if (existing) return res.status(409).json({ error: 'PHONE_ALREADY_USED' });

    const passwordHash = await bcrypt.hash(password, 12);
    const [driver] = await db('drivers')
      .insert({ name, phone, phone_hash: phoneHash, password_hash: passwordHash, status: 'offline' })
      .returning(['id', 'name']);

    const payload = { id: driver.id, name: driver.name };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    await db('drivers').where({ id: driver.id }).update({ status: 'available' });

    res.status(201).json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/auth/login', loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { phone, password } = req.body;

    const phoneHash = hashWaId(phone);
    const driver = await db('drivers').where({ phone_hash: phoneHash }).first();

    // bcrypt.compare dure ~100ms même si driver est null — protège contre timing attack
    const valid = await bcrypt.compare(password, driver?.password_hash ?? '$2b$12$invalidhashpadding000000000000000000000000000000000000000');
    if (!driver || !valid) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    await db('drivers').where({ id: driver.id }).update({ status: 'available' });

    const payload = { id: driver.id, name: driver.name };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/auth/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const { id, name } = jwt.verify(req.body.refreshToken, env.JWT_REFRESH_SECRET);
    const accessToken = jwt.sign({ id, name }, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'REFRESH_INVALID' });
  }
});

router.post('/auth/logout', requireAuth, async (req, res) => {
  try {
    await db('drivers').where({ id: req.driver.id }).update({ status: 'offline', fcm_token: null });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Config publique driver ──────────────────────────────────────────────────

// GET /api/drivers/config — numéro Call Center et autres params utiles au driver
router.get('/drivers/config', requireAuth, async (_req, res) => {
  res.json({
    ccPhone: process.env.CC_PHONE || null,
  });
});

// ─── FCM token ────────────────────────────────────────────────────────────────

// PUT /api/drivers/fcm-token — Flutter enregistre son token à chaque login/refresh
router.put('/drivers/fcm-token', requireAuth, validate(fcmTokenSchema), async (req, res) => {
  try {
    await db('drivers').where({ id: req.driver.id }).update({ fcm_token: req.body.token });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Disponibilité driver ────────────────────────────────────────────────────

router.patch('/drivers/me/availability', requireAuth, async (req, res) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') return res.status(400).json({ error: 'INVALID_BODY' });
    await db('drivers').where({ id: req.driver.id }).update({ is_available: isAvailable });
    emitDriverAvailability(req.driver.id, req.driver.name, isAvailable);
    res.json({ ok: true, isAvailable });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/drivers/me', requireAuth, async (req, res) => {
  try {
    const driver = await db('drivers')
      .where({ id: req.driver.id })
      .first('id', 'name', 'is_available as isAvailable');
    if (!driver) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ driver });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Courses disponibles ──────────────────────────────────────────────────────

router.get('/deliveries/available', requireAuth, async (req, res) => {
  try {
    const deliveries = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.status', 'pending')
      // Exclure les courses que ce livreur a explicitement refusées
      .whereNotExists(
        db('delivery_refusals')
          .whereRaw('delivery_refusals.delivery_id = deliveries.id')
          .where('delivery_refusals.driver_id', req.driver.id)
      )
      .orderBy('deliveries.created_at', 'desc')
      .select(
        'deliveries.id',
        'deliveries.description',
        'deliveries.status',
        'deliveries.created_at as createdAt',
        'deliveries.initial_media_type as initialMediaType',
        'deliveries.initial_media_url as initialMediaUrl',
        'deliveries.pickup_address as pickupAddress',
        'deliveries.dropoff_address as dropoffAddress',
        'deliveries.price',
        'clients.alias as clientAlias'
        // JAMAIS : wa_id_hash, wa_id_enc, client_id
      );

    res.json({ deliveries });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Livreur refuse explicitement une course (ne la reverra plus)
router.post('/deliveries/:id/refuse', requireAuth, async (req, res) => {
  try {
    const delivery = await db('deliveries').where({ id: req.params.id, status: 'pending' }).first('id');
    if (!delivery) return res.status(404).json({ error: 'DELIVERY_NOT_FOUND' });

    await db('delivery_refusals')
      .insert({ delivery_id: req.params.id, driver_id: req.driver.id })
      .onConflict(['delivery_id', 'driver_id']).ignore();

    // Notifier l'admin si tous les livreurs disponibles ont refusé
    const availableDriverIds = await db('drivers')
      .where({ is_available: true, suspended: false })
      .pluck('id');

    if (availableDriverIds.length > 0) {
      const refusedCount = await db('delivery_refusals')
        .where('delivery_id', req.params.id)
        .whereIn('driver_id', availableDriverIds)
        .count('id as n')
        .first();

      if (Number(refusedCount.n) >= availableDriverIds.length) {
        const { emitAllDriversRefused } = await import('../services/socket.js');
        emitAllDriversRefused(req.params.id);
      }
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Courses actives du driver (assigned/in_progress)
router.get('/deliveries/mine', requireAuth, async (req, res) => {
  try {
    const deliveries = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where({ 'deliveries.driver_id': req.driver.id })
      .whereIn('deliveries.status', ['assigned', 'in_progress'])
      .orderBy('deliveries.assigned_at', 'desc')
      .select(
        'deliveries.id',
        'deliveries.description',
        'deliveries.status',
        'deliveries.created_at as createdAt',
        'deliveries.initial_media_type as initialMediaType',
        'deliveries.initial_media_url as initialMediaUrl',
        'deliveries.pickup_address as pickupAddress',
        'deliveries.dropoff_address as dropoffAddress',
        'deliveries.price',
        'clients.alias as clientAlias'
      );
    res.json({ deliveries });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/deliveries/:id/accept', requireAuth, async (req, res) => {
  try {
    const delivery = await acceptDelivery(req.params.id, req.driver.id);
    res.json({ delivery });
  } catch (err) {
    const clientCodes = ['ALREADY_TAKEN', 'DELIVERY_NOT_FOUND'];
    if (clientCodes.includes(err.code)) return res.status(409).json({ error: err.code });
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/deliveries/:id/status', requireAuth, validate(statusSchema), async (req, res) => {
  try {
    const delivery = await updateDeliveryStatus(req.params.id, req.driver.id, req.body.status);

    if (req.body.status === 'cancelled') {
      emitDeliveryCancelled(req.params.id);
    }

    res.json({ delivery });
  } catch (err) {
    const clientCodes = ['DELIVERY_NOT_FOUND', 'INVALID_TRANSITION'];
    if (clientCodes.includes(err.code)) return res.status(400).json({ error: err.code });
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Messagerie ───────────────────────────────────────────────────────────────

router.post('/deliveries/:id/message', requireAuth, validate(messageSchema), async (req, res) => {
  try {
    const { message } = await relayDriverMessage(req.params.id, req.driver.id, req.body);
    res.json({ message: { id: message.id, type: message.type, createdAt: message.created_at } });
  } catch (err) {
    const clientCodes = ['DELIVERY_NOT_FOUND', 'CLIENT_NOT_FOUND', 'UNSUPPORTED_TYPE'];
    if (clientCodes.includes(err.code)) return res.status(400).json({ error: err.code });
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/deliveries/:id/messages', requireAuth, async (req, res) => {
  try {
    const delivery = await db('deliveries')
      .where({ id: req.params.id, driver_id: req.driver.id })
      .first('id');

    if (!delivery) return res.status(404).json({ error: 'DELIVERY_NOT_FOUND' });

    const messages = await db('messages')
      .where({ delivery_id: req.params.id })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role', 'type', 'content', 'meta', 'created_at as createdAt');

    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Upload média ─────────────────────────────────────────────────────────────

// GET /api/deliveries/:id/presign?type=audio&ext=ogg
// Retourne une URL PUT pré-signée R2 valable 5 minutes
router.get(
  '/deliveries/:id/presign',
  requireAuth,
  validate(presignQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { type, ext } = req.query;
      const key = `media/${req.params.id}/${type}/${Date.now()}_${req.driver.id}.${ext}`;
      const uploadUrl = await getSignedUploadUrl(key);
      res.json({ uploadUrl, key });
    } catch {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  }
);

// ── Chat CC ↔ Livreur ─────────────────────────────────────────────────────────

router.get('/drivers/cc-chat', requireAuth, async (req, res) => {
  try {
    const messages = await db('cc_driver_messages')
      .where({ driver_id: req.driver.id })
      .orderBy('created_at', 'asc')
      .select('id', 'sender_role as senderRole', 'type', 'content', 'created_at as createdAt');
    await db('cc_driver_messages')
      .where({ driver_id: req.driver.id, read_by_driver: false })
      .update({ read_by_driver: true });
    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/drivers/cc-chat', requireAuth, async (req, res) => {
  try {
    const { content, type = 'text' } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    const validTypes = ['text', 'audio', 'image'];
    const msgType = validTypes.includes(type) ? type : 'text';
    const [msg] = await db('cc_driver_messages')
      .insert({ driver_id: req.driver.id, sender_role: 'driver', type: msgType, content: content.trim() })
      .returning('id', 'sender_role', 'type', 'content', 'created_at');
    const out = { id: msg.id, senderRole: msg.sender_role, type: msg.type, content: msg.content, createdAt: msg.created_at };
    emitDriverReplyToCC(req.driver.id, req.driver.name, out);
    res.json({ message: out });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
