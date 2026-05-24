import rateLimit from 'express-rate-limit';

const json = (res, _req, _next) =>
  res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });

// Tentatives de login : 10 par 15 minutes par IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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
