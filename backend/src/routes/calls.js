import { Router } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { initiateConferenceCall, twilioEnabled } from '../services/twilio.js';
import { decryptWaId } from '../services/pii-filter.js';
import { emitCCMessageToDriver } from '../services/socket.js';

const router = Router();

function genConferenceId() {
  return `call_${randomBytes(8).toString('hex')}`;
}

function requireCallCenter(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'call_center') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

function notConfigured(res) {
  return res.status(503).json({ error: 'TWILIO_NOT_CONFIGURED' });
}

// ── Livreur → CC ──────────────────────────────────────────────────────────────
router.post('/calls/driver-to-cc', requireAuth, async (req, res) => {
  if (!twilioEnabled()) return notConfigured(res);
  if (!env.CC_PHONE) return res.status(503).json({ error: 'CC_PHONE_NOT_CONFIGURED' });

  try {
    const driver = await db('drivers').where({ id: req.driver.id }).first('id', 'name', 'phone');
    if (!driver?.phone) return res.status(400).json({ error: 'DRIVER_NO_PHONE' });

    const conferenceId = genConferenceId();
    const { callerSid, calleeSid } = await initiateConferenceCall({
      callerPhone: driver.phone,
      calleePhone: env.CC_PHONE,
      conferenceId,
    });

    // Notifier l'admin que le livreur essaie de joindre le CC
    emitCCMessageToDriver(req.driver.id, {
      type: 'call',
      content: 'Appel en cours…',
      meta: { conferenceId, direction: 'driver_to_cc' },
      createdAt: new Date().toISOString(),
    });

    res.json({ conferenceId, callerSid, calleeSid });
  } catch (err) {
    console.error('[calls] driver→cc:', err.message);
    res.status(500).json({ error: 'CALL_FAILED' });
  }
});

// ── CC → Livreur ──────────────────────────────────────────────────────────────
router.post('/calls/cc-to-driver', requireCallCenter, async (req, res) => {
  if (!twilioEnabled()) return notConfigured(res);

  const { driverId, ccPhone } = req.body;
  if (!driverId) return res.status(400).json({ error: 'MISSING_DRIVER_ID' });
  if (!ccPhone) return res.status(400).json({ error: 'MISSING_CC_PHONE' });

  try {
    const driver = await db('drivers').where({ id: driverId }).first('id', 'name', 'phone');
    if (!driver) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    if (!driver.phone) return res.status(400).json({ error: 'DRIVER_NO_PHONE' });

    const conferenceId = genConferenceId();
    const { callerSid, calleeSid } = await initiateConferenceCall({
      callerPhone: ccPhone,
      calleePhone: driver.phone,
      conferenceId,
    });

    res.json({ conferenceId, callerSid, calleeSid });
  } catch (err) {
    console.error('[calls] cc→driver:', err.message);
    res.status(500).json({ error: 'CALL_FAILED' });
  }
});

// ── CC → Client ───────────────────────────────────────────────────────────────
router.post('/calls/cc-to-client', requireCallCenter, async (req, res) => {
  if (!twilioEnabled()) return notConfigured(res);

  const { clientId, ccPhone } = req.body;
  if (!clientId) return res.status(400).json({ error: 'MISSING_CLIENT_ID' });
  if (!ccPhone) return res.status(400).json({ error: 'MISSING_CC_PHONE' });

  try {
    const client = await db('clients').where({ id: clientId }).first('id', 'wa_id_enc');
    if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
    if (!client.wa_id_enc) return res.status(400).json({ error: 'CLIENT_NO_PHONE' });

    let clientPhone;
    try {
      clientPhone = decryptWaId(client.wa_id_enc);
    } catch {
      return res.status(400).json({ error: 'CLIENT_PHONE_DECRYPT_FAILED' });
    }

    // Normaliser en E.164 si nécessaire (le numéro WhatsApp peut manquer le +)
    if (!clientPhone.startsWith('+')) clientPhone = `+${clientPhone}`;

    const conferenceId = genConferenceId();
    const { callerSid, calleeSid } = await initiateConferenceCall({
      callerPhone: ccPhone,
      calleePhone: clientPhone,
      conferenceId,
    });

    res.json({ conferenceId, callerSid, calleeSid });
  } catch (err) {
    console.error('[calls] cc→client:', err.message);
    res.status(500).json({ error: 'CALL_FAILED' });
  }
});

// ── Livreur → Client (via livraison) ─────────────────────────────────────────
router.post('/calls/driver-to-client', requireAuth, async (req, res) => {
  if (!twilioEnabled()) return notConfigured(res);

  const { deliveryId } = req.body;
  if (!deliveryId) return res.status(400).json({ error: 'MISSING_DELIVERY_ID' });

  try {
    const driver = await db('drivers').where({ id: req.driver.id }).first('id', 'name', 'phone');
    if (!driver?.phone) return res.status(400).json({ error: 'DRIVER_NO_PHONE' });

    const delivery = await db('deliveries')
      .where({ id: deliveryId, driver_id: req.driver.id })
      .first('id', 'client_id');
    if (!delivery) return res.status(404).json({ error: 'DELIVERY_NOT_FOUND' });

    const clientRow = await db('clients').where({ id: delivery.client_id }).first('wa_id_enc');
    if (!clientRow?.wa_id_enc) return res.status(400).json({ error: 'CLIENT_NO_PHONE' });

    let clientPhone;
    try {
      clientPhone = decryptWaId(clientRow.wa_id_enc);
    } catch {
      return res.status(400).json({ error: 'CLIENT_PHONE_DECRYPT_FAILED' });
    }
    if (!clientPhone.startsWith('+')) clientPhone = `+${clientPhone}`;

    const conferenceId = genConferenceId();
    const { callerSid, calleeSid } = await initiateConferenceCall({
      callerPhone: driver.phone,
      calleePhone: clientPhone,
      conferenceId,
    });

    res.json({ conferenceId, callerSid, calleeSid });
  } catch (err) {
    console.error('[calls] driver→client:', err.message);
    res.status(500).json({ error: 'CALL_FAILED' });
  }
});

export default router;
