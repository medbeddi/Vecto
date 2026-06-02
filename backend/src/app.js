import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { initSocket } from './services/socket.js';
import { initFCM } from './services/fcm.js';
import { apiLimiter, webhookLimiter } from './middleware/rate-limit.js';
import whatsappWebhook from './webhooks/whatsapp.js';
import driverRouter from './routes/driver.js';
import otpRouter from './routes/otp.js';
import walletRouter from './routes/wallet.js';
import simRouter from './routes/sim.js';
import uploadRouter from './routes/upload.js';
import adminRouter from './routes/admin.js';
import clientRouter from './routes/client.js';

const app = express();
const httpServer = createServer(app);

app.set('trust proxy', 1);

// ─── Sécurité & CORS ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'", "wss:", "ws:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "https:", "blob:"],
    },
  },
}));
app.use(cors({
  origin: env.ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Logging HTTP (sans body — pas de risque PII) ─────────────────────────────
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Parsing ──────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Socket.IO (avant routes : getIO() doit être prêt) ───────────────────────
initSocket(httpServer);

// ─── FCM (optionnel, async — ne bloque pas le démarrage) ─────────────────────
initFCM();

// ─── Webhooks Meta ────────────────────────────────────────────────────────────
app.use('/webhook/whatsapp', webhookLimiter, whatsappWebhook);

// ─── API REST Flutter ─────────────────────────────────────────────────────────
app.use('/api', apiLimiter, otpRouter);
app.use('/api', apiLimiter, driverRouter);
app.use('/api', apiLimiter, walletRouter);
app.use('/api', apiLimiter, uploadRouter);
app.use('/api', apiLimiter, adminRouter);
app.use('/api', apiLimiter, clientRouter);

// ─── Fichiers uploadés (dev) ──────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Simulateur client (aussi en prod pour l'app client mobile) ──────────────
app.use('/sim', simRouter);

// ─── Admin web app ────────────────────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, '../../apps/admin')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Gestion des erreurs globales ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[app] erreur non gérée:', err.message);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
httpServer.listen(env.PORT, () => {
  console.info(`[server] en écoute sur le port ${env.PORT} (${env.NODE_ENV})`);
});

// ─── Arrêt gracieux ───────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.info(`[server] ${signal} reçu — arrêt propre`);
  httpServer.close(async () => {
    const { default: db } = await import('./config/db.js');
    await db.destroy();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, httpServer };
