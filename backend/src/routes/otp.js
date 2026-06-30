import { Router } from 'express';
import { randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId } from '../services/pii-filter.js';
import { otpLimiter } from '../middleware/rate-limit.js';
import { sendOtpViaTwilio, checkOtpViaTwilio, twilioVerifyEnabled } from '../services/twilio.js';

const router = Router();

function generateCode() {
  return randomInt(1000, 10000).toString();
}

// ── Envoi OTP via WATI (WhatsApp template) ───────────────────────────────────
async function sendOtpViaWati(phone, code) {
  const to = phone.replace(/^\+/, '');
  const res = await fetch(`${env.WATI_API_URL}/api/v1/sendTemplateMessages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WATI_API_KEY}` },
    body: JSON.stringify({
      template_name: 'otp',
      broadcast_name: `otp_${Date.now()}`,
      receivers: [{ whatsappNumber: to, customParams: [{ name: '1', value: code }] }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`WATI échec: ${err?.message ?? res.status}`);
  }
}

// ── Envoi OTP via WhatsApp Cloud API (fallback historique) ────────────────────
async function sendOtpWhatsApp(phone, phoneHash, code) {
  if (env.NODE_ENV !== 'production') {
    console.info(`[OTP] code pour hash=${phoneHash.slice(0, 8)}... : ${code}`);
    return;
  }
  if (env.WATI_API_URL && env.WATI_API_KEY) {
    return sendOtpViaWati(phone, code);
  }

  const to = phone.replace(/\D/g, '');
  const body = env.WA_OTP_TEMPLATE_NAME
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: env.WA_OTP_TEMPLATE_NAME,
          language: { code: 'fr' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: `🛵 *Vecto* — Votre code de vérification est : *${code}*\n\nValable 10 minutes. Ne le partagez jamais.` },
      };

  const res = await fetch(`https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WA_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp échec: ${err?.error?.message ?? res.status}`);
  }
}

// ── Envoyer l'OTP : WhatsApp en priorité, Twilio SMS/Voice en secours ─────────
async function sendOtp(phoneRaw, phoneHash) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db('otps').where({ phone_hash: phoneHash, used: false }).update({ used: true });
  await db('otps').insert({ phone_hash: phoneHash, code, expires_at: expiresAt });

  try {
    await sendOtpWhatsApp(phoneRaw, phoneHash, code);
    return 'whatsapp';
  } catch (err) {
    console.error('[OTP] WhatsApp échec:', err.message);
    if (twilioVerifyEnabled()) {
      try {
        await sendOtpViaTwilio(phoneRaw);
        return 'sms';
      } catch (err2) {
        console.error('[OTP] Twilio fallback échec:', err2.message);
      }
    }
    throw err;
  }
}

// ── Vérifier le code OTP : DB (WhatsApp) en priorité, Twilio en secours ───────
async function verifyCode(phoneRaw, phoneHash, code) {
  const otp = await db('otps')
    .where({ phone_hash: phoneHash, code, used: false })
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .first();
  if (otp) {
    await db('otps').where({ id: otp.id }).update({ used: true });
    return true;
  }
  if (twilioVerifyEnabled()) {
    try {
      return await checkOtpViaTwilio(phoneRaw, code);
    } catch (err) {
      console.error('[OTP] Twilio check échec:', err.message);
    }
  }
  return false;
}

// ── Envoyer OTP ───────────────────────────────────────────────────────────────
router.post('/otp/send', otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'INVALID_PHONE' });
    }

    const phoneRaw = phone.trim();
    const phoneHash = hashWaId(phoneRaw);

    const channel = await sendOtp(phoneRaw, phoneHash);
    res.json({ sent: true, channel });
  } catch (e) {
    console.error('[OTP] send error:', e.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Vérifier OTP + créer/retourner compte client ──────────────────────────────
router.post('/otp/verify/client', otpLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phoneRaw = phone.trim();
    const phoneHash = hashWaId(phoneRaw);

    const valid = await verifyCode(phoneRaw, phoneHash, code);
    if (!valid) return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });

    // Upsert client
    let client = await db('clients').where({ wa_id_hash: phoneHash }).first();
    if (!client) {
      const alias = `Client #${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const { encryptWaId } = await import('../services/pii-filter.js');
      const waEnc = encryptWaId(phoneRaw);
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
    console.error('[OTP] verify/client error:', e.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Vérifier OTP + créer compte driver (1ère inscription) ────────────────────
router.post('/otp/verify/driver', otpLimiter, async (req, res) => {
  try {
    const { phone, code, name, password } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phoneRaw = phone.trim();
    const phoneHash = hashWaId(phoneRaw);

    const valid = await verifyCode(phoneRaw, phoneHash, code);
    if (!valid) return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });

    // Compte existant — connexion directe après OTP
    let driver = await db('drivers').where({ phone_hash: phoneHash }).first();
    if (driver?.suspended) return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    if (driver && !driver.phone) {
      await db('drivers').where({ id: driver.id }).update({ phone: phoneRaw });
      driver.phone = phoneRaw;
    }
    if (!driver) {
      if (!name || name.trim().length < 2) return res.status(400).json({ error: 'NAME_REQUIRED' });
      if (!password || !/^\d{4}$/.test(password)) return res.status(400).json({ error: 'PASSWORD_DIGITS_ONLY' });

      const passwordHash = await bcrypt.hash(password, 12);
      [driver] = await db('drivers')
        .insert({ name: name.trim(), phone: phoneRaw, phone_hash: phoneHash, password_hash: passwordHash, status: 'available' })
        .returning(['id', 'name', 'status']);
    }

    const payload = { id: driver.id, name: driver.name, role: 'driver' };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch (err) {
    console.error('[OTP] verify/driver error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ── Réinitialiser le mot de passe via OTP ─────────────────────────────────────
router.post('/auth/reset-password', otpLimiter, async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    if (!/^\d{4}$/.test(newPassword)) {
      return res.status(400).json({ error: 'PASSWORD_DIGITS_ONLY' });
    }

    const phoneRaw = phone.trim();
    const phoneHash = hashWaId(phoneRaw);

    const valid = await verifyCode(phoneRaw, phoneHash, code);
    if (!valid) {
      console.warn('[reset-password] OTP invalide ou expiré pour hash:', phoneHash.slice(0, 8));
      return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });
    }

    const driver = await db('drivers').where({ phone_hash: phoneHash }).first();
    if (!driver) {
      console.warn('[reset-password] driver introuvable pour hash:', phoneHash.slice(0, 8));
      return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
    }
    if (driver.suspended) return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db('drivers').where({ id: driver.id }).update({ password_hash: passwordHash });

    const payload = { id: driver.id, name: driver.name, role: 'driver' };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch (err) {
    console.error('[reset-password] erreur:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
