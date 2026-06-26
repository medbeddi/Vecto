import { Router } from 'express';
import { randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId } from '../services/pii-filter.js';
import { otpLimiter, loginLimiter } from '../middleware/rate-limit.js';

const router = Router();

function generateCode() {
  return randomInt(1000, 10000).toString();
}

async function sendOtpViaWati(phone, code) {
  const to = phone.replace(/^\+/, '');
  const res = await fetch(
    `${env.WATI_API_URL}/api/v1/sendTemplateMessages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WATI_API_KEY}`,
      },
      body: JSON.stringify({
        template_name: 'otp',
        broadcast_name: `otp_${Date.now()}`,
        receivers: [
          {
            whatsappNumber: to,
            customParams: [{ name: '1', value: code }],
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[OTP] WATI échec:', err?.message ?? res.status);
  }
}

async function sendOtpWhatsApp(phone, phoneHash, code) {
  // Log en dev pour tester sans WhatsApp
  if (env.NODE_ENV !== 'production') {
    console.info(`[OTP] code pour hash=${phoneHash.slice(0, 8)}... : ${code}`);
    return;
  }

  // WATI en priorité — pas de restriction de niveau de confiance
  if (env.WATI_API_URL && env.WATI_API_KEY) {
    return sendOtpViaWati(phone, code);
  }

  // Numéro en format E.164 sans le +
  const to = phone.replace(/\D/g, '');

  // Les messages OTP sont business-initiated → obligation d'utiliser un template approuvé.
  // Un message texte libre ne fonctionnerait que si le driver a écrit en premier (fenêtre 24h).
  // Si un template approuvé est configuré, l'utiliser (préféré pour les nouveaux drivers)
  // Sinon fallback en texte libre (fonctionne uniquement si le driver a déjà écrit au numéro)
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

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WA_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[OTP] échec envoi WhatsApp:', err?.error?.message ?? res.status);
  }
}

// ── Envoyer OTP ───────────────────────────────────────────────────────────────
router.post('/otp/send', otpLimiter, async (req, res) => {
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

    // WhatsApp non-bloquant : si l'envoi échoue, le code est quand même en DB
    sendOtpWhatsApp(phone.trim(), phoneHash, code).catch((err) => {
      console.error('[OTP] WhatsApp failed (non-blocking):', err.message);
    });

    res.json({ sent: true });
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

// ── Vérifier OTP + créer compte driver (1ère inscription) ────────────────────
router.post('/otp/verify/driver', otpLimiter, async (req, res) => {
  try {
    const { phone, code, name, password } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const phoneHash = hashWaId(phone.trim());

    const otp = await db('otps')
      .where({ phone_hash: phoneHash, code, used: false })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!otp) return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });

    await db('otps').where({ id: otp.id }).update({ used: true });

    // Compte existant — connexion directe après OTP
    let driver = await db('drivers').where({ phone_hash: phoneHash }).first();
    if (driver?.suspended) return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    if (driver && !driver.phone) {
      await db('drivers').where({ id: driver.id }).update({ phone: phone.trim() });
      driver.phone = phone.trim();
    }
    if (!driver) {
      // Nouveau driver — nom + mot de passe requis
      if (!name || name.trim().length < 2) return res.status(400).json({ error: 'NAME_REQUIRED' });
      if (!password || !/^\d{4}$/.test(password)) return res.status(400).json({ error: 'PASSWORD_DIGITS_ONLY' });

      const passwordHash = await bcrypt.hash(password, 12);
      [driver] = await db('drivers')
        .insert({ name: name.trim(), phone: phone.trim(), phone_hash: phoneHash, password_hash: passwordHash, status: 'available' })
        .returning(['id', 'name', 'status']);
    }

    const payload = { id: driver.id, name: driver.name, role: 'driver' };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch {
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

    const phoneHash = hashWaId(phone.trim());

    const otp = await db('otps')
      .where({ phone_hash: phoneHash, code, used: false })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!otp) {
      console.warn('[reset-password] OTP invalide ou expiré pour hash:', phoneHash.slice(0, 8));
      return res.status(401).json({ error: 'INVALID_OR_EXPIRED_CODE' });
    }

    await db('otps').where({ id: otp.id }).update({ used: true });

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
