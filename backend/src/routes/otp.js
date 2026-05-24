import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId } from '../services/pii-filter.js';
import { loginLimiter } from '../middleware/rate-limit.js';

const router = Router();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpWhatsApp(phoneHash, code) {
  // En production : envoyer via WhatsApp API
  // Pour l'instant on log le code (visible dans Railway logs)
  console.info(`[OTP] code pour hash=${phoneHash.slice(0, 8)}... : ${code}`);
  // TODO: appeler l'API WhatsApp pour envoyer le code
}

// ── Envoyer OTP ───────────────────────────────────────────────────────────────
router.post('/otp/send', loginLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'INVALID_PHONE' });
    }

    const phoneHash = hashWaId(phone.trim());
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalider les anciens codes
    await db('otps').where({ phone_hash: phoneHash, used: false }).update({ used: true });

    await db('otps').insert({ phone_hash: phoneHash, code, expires_at: expiresAt });

    await sendOtpWhatsApp(phoneHash, code);

    // En dev : retourner le code directement
    const isDev = env.NODE_ENV !== 'production';
    res.json({ sent: true, ...(isDev ? { code } : {}) });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Vérifier OTP + créer/retourner compte client ──────────────────────────────
router.post('/otp/verify/client', loginLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phoneHash = hashWaId(phone.trim());

    const otp = await db('otps')
      .where({ phone_hash: phoneHash, code, used: false })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!otp) return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });

    // Marquer comme utilisé
    await db('otps').where({ id: otp.id }).update({ used: true });

    // Upsert client
    let client = await db('clients').where({ wa_id_hash: phoneHash }).first();
    if (!client) {
      const alias = `Client #${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const { encryptWaId } = await import('../services/pii-filter.js');
      const waEnc = encryptWaId(phone.trim());
      [client] = await db('clients')
        .insert({ wa_id_hash: phoneHash, wa_id_enc: waEnc, alias })
        .returning('*');
    }

    const token = jwt.sign(
      { id: client.id, alias: client.alias, role: 'client' },
      env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, client: { id: client.id, alias: client.alias } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Vérifier OTP + créer/retourner compte driver ──────────────────────────────
router.post('/otp/verify/driver', loginLimiter, async (req, res) => {
  try {
    const { phone, code, name } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phoneHash = hashWaId(phone.trim());

    const otp = await db('otps')
      .where({ phone_hash: phoneHash, code, used: false })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!otp) return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });

    await db('otps').where({ id: otp.id }).update({ used: true });

    // Upsert driver
    let driver = await db('drivers').where({ phone_hash: phoneHash }).first();
    if (!driver) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'NAME_REQUIRED' });
      }
      [driver] = await db('drivers')
        .insert({ name: name.trim(), phone_hash: phoneHash, status: 'available' })
        .returning(['id', 'name', 'status']);
    }

    const payload = { id: driver.id, name: driver.name };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
