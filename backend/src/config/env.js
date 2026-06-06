import { config } from 'dotenv';
config();

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'WA_TOKEN',
  'WA_PHONE_ID',
  'WA_VERIFY_TOKEN',
  'WA_SALT',
  'WA_ENCRYPTION_KEY',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
}

if (process.env.WA_ENCRYPTION_KEY.length !== 64) {
  throw new Error('WA_ENCRYPTION_KEY doit être exactement 64 caractères hex (32 bytes)');
}

// R2 optionnel — si absent, les médias WhatsApp entrants sont ignorés
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const missingR2 = R2_VARS.filter((k) => !process.env[k]);
if (missingR2.length > 0) {
  console.warn(`[env] R2 non configuré (${missingR2.join(', ')}) — médias WhatsApp entrants désactivés`);
}

export const env = {
  // WhatsApp
  WA_TOKEN: process.env.WA_TOKEN,
  WA_PHONE_ID: process.env.WA_PHONE_ID,
  WA_VERIFY_TOKEN: process.env.WA_VERIFY_TOKEN,
  WA_SALT: process.env.WA_SALT,
  WA_ENCRYPTION_KEY: process.env.WA_ENCRYPTION_KEY,

  // Base de données
  DATABASE_URL: process.env.DATABASE_URL,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || '1h',
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || '30d',

  // R2 — optionnel
  R2_ENABLED: missingR2.length === 0,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || '',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || '',

  // FCM — optionnel (notifications push désactivées si absent)
  FCM_SERVICE_ACCOUNT: process.env.FCM_SERVICE_ACCOUNT || null,

  // OpenAI — optionnel (transcription vocale désactivée si absent)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,

  // CORS — liste d'origines séparées par des virgules, ex: http://localhost:3000,https://admin.monapp.com
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : '*',

  // Serveur
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
};
