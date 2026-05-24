import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;  // 96 bits recommandé pour GCM

// ─── Hash (irréversible, pour lookups) ────────────────────────────────────────

export function hashWaId(waId) {
  return createHash('sha256')
    .update(waId + env.WA_SALT)
    .digest('hex');
}

// ─── Chiffrement (réversible, pour envoi de messages retour) ──────────────────

export function encryptWaId(waId) {
  const key = Buffer.from(env.WA_ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(waId, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: <iv_hex>:<tag_hex>:<data_hex>
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptWaId(stored) {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('FORMAT_INVALID');
  const [ivHex, tagHex, encHex] = parts;
  const key = Buffer.from(env.WA_ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ─── Sanitisation texte ───────────────────────────────────────────────────────

// Formats couverts :
//   +222 XX XX XX XX    — Mauritanie
//   +212 6XX XXX XXX    — Maroc
//   +33 6 XX XX XX XX   — France
//   +213 XX XX XX XX XX — Algérie
//   +216 XX XXX XXX     — Tunisie
//   +221 XX XXX XX XX   — Sénégal
//   00<indicatif>...    — variante européenne
//   Formats locaux 8-10 chiffres sans indicatif

const PHONE_PATTERNS = [
  // International avec indicatif connu (priorité haute, évite les faux positifs)
  /(?:\+|00)(?:222|212|33|213|216|221|226|225|234|1|44|49|34|39|55|7|86|91)[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,4}){2,5}/g,

  // Pattern générique de la spec (filet de sécurité)
  /(\+?[\d\s\-().]{7,15}\d)/g,
];

export function sanitizeText(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const pattern of PHONE_PATTERNS) {
    // Réinitialiser lastIndex entre chaque appel sur la même string
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[numéro masqué]');
  }
  return result;
}
