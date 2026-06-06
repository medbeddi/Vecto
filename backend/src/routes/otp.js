import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId } from '../services/pii-filter.js';
import { otpLimiter, loginLimiter } from '../middleware/rate-limit.js';

const router = Router();

function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
}

async function sendOtpWhatsApp(phone, phoneHash, code) {
  // Log en dev pour tester sans WhatsApp
  if (env.NODE_ENV !== 'production') {
    console.info(`[OTP] code pour hash=${phoneHash.slice(0, 8)}... : ${code}`);
    return;
  }

  // Numéro en format E.164 sans le +
  const to = phone.replace(/\D/g, '');

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WA_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: `🛵 *Vecto* — Votre code de vérification est :\n\n*${code}*\n\nValable 10 minutes. Ne le partagez jamais.`,
        },
      }),
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
      console.info(`[OTP] code fallback hash=${phoneHash.slice(0, 8)}... : ${code}`);
    });

    // En dev : retourner le code directement
    const isDev = env.NODE_ENV !== 'production';
    res.json({ sent: true, ...(isDev ? { code } : {}) });
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
    if (!driver) {
      // Nouveau driver — nom + mot de passe requis
      if (!name || name.trim().length < 2) return res.status(400).json({ error: 'NAME_REQUIRED' });
      if (!password || password.length < 6) return res.status(400).json({ error: 'PASSWORD_REQUIRED' });

      const passwordHash = await bcrypt.hash(password, 12);
      [driver] = await db('drivers')
        .insert({ name: name.trim(), phone_hash: phoneHash, password_hash: passwordHash, status: 'available' })
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

// ── Réinitialiser le mot de passe via OTP ─────────────────────────────────────
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    }

    const phoneHash = hashWaId(phone.trim());

    // Chercher l'OTP — on accepte aussi les codes récemment expirés (<2min) pour tolérer les décalages
    const otp = await db('otps')
      .where({ phone_hash: phoneHash, code, used: false })
      .where('expires_at', '>', new Date(Date.now() - 2 * 60 * 1000))
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

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db('drivers').where({ id: driver.id }).update({ password_hash: passwordHash });

    const payload = { id: driver.id, name: driver.name };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES });

    res.json({ accessToken, refreshToken, driver: { id: driver.id, name: driver.name } });
  } catch (err) {
    console.error('[reset-password] erreur:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
