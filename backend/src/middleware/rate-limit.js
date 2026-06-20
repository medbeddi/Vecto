import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV !== 'production';

const json = (_req, res) =>
  res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });

// Tentatives de login (par IP) — plus souple en dev pour éviter les blocages pendant les tests
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 15,
  handler: json,
  standardHeaders: true,
  legacyHeaders: false,
});

// Envoi d'OTP — toujours strict même en dev (anti-spam)
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 30 : 5,
  handler: json,
  standardHeaders: true,
  legacyHeaders: false,
});

// API générale : 120 requêtes par minute par IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  handler: json,
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhook Meta : 500 par minute (Meta peut envoyer en rafale)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  handler: json,
  standardHeaders: true,
  legacyHeaders: false,
});
