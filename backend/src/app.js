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
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io", "unpkg.com", "maps.googleapis.com", "maps.gstatic.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'", "wss:", "ws:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "unpkg.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "*.openstreetmap.org", "*.googleapis.com", "*.gstatic.com"],
      mediaSrc: ["'self'", "https:", "blob:"],
      workerSrc: ["blob:"],
      frameSrc: ["https://www.openstreetmap.org"],
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

// ─── Privacy policy (requis par Meta pour publication) ────────────────────────
app.get('/privacy', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Politique de confidentialité — Vecto</title>
<style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#333;line-height:1.7}h1{color:#1a1a1a}h2{margin-top:2em}</style></head>
<body><h1>Politique de confidentialité</h1>
<p>Dernière mise à jour : ${new Date().toLocaleDateString('fr-FR')}</p>
<h2>Données collectées</h2>
<p>Vecto collecte uniquement les données nécessaires à la prestation du service de livraison : numéro WhatsApp (chiffré), messages de commande, et position GPS des livreurs pendant leur service.</p>
<h2>Utilisation des données</h2>
<p>Les données sont utilisées exclusivement pour mettre en relation les clients et les livreurs. Aucune donnée n'est vendue ou partagée avec des tiers.</p>
<h2>Conservation</h2>
<p>Les données sont conservées pendant la durée nécessaire à la prestation du service et supprimées sur demande.</p>
<h2>Contact</h2>
<p>Pour toute question : <a href="mailto:medronaldo8@gmail.com">medronaldo8@gmail.com</a></p>
</body></html>`);
});

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
