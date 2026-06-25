import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { uploadToR2, extFromMime, getSignedMediaUrl } from '../services/media.js';
import { env } from '../config/env.js';

function requireAnyAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    jwt.verify(token, env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/', 'image/'];
    if (allowed.some((t) => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error('Type de fichier non supporté'));
  },
});

// Convert any audio format to ogg/opus (required by WhatsApp Cloud API for PTT voice notes)
function convertToOgg(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.ogg');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'ogg',
      outputPath,
    ]);
    proc.on('close', (code) => code === 0 ? resolve(outputPath) : reject(new Error(`ffmpeg exit ${code}`)));
    proc.on('error', reject);
    proc.stderr.on('data', () => {});
  });
}

async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

  let filePath = req.file.path;
  let mimetype = req.file.mimetype;

  // Convert all non-ogg audio to ogg/opus for WhatsApp PTT voice notes
  // (covers webm from browser, m4a/mp4 from iOS/Android Expo recording)
  if (mimetype.startsWith('audio/') && !mimetype.includes('ogg')) {
    try {
      const oggPath = await convertToOgg(filePath);
      try { unlinkSync(filePath); } catch {}
      filePath = oggPath;
      mimetype = 'audio/ogg';
      console.info('[upload] audio→ogg conversion OK (input was %s)', req.file.mimetype);
    } catch (err) {
      console.error('[upload] audio→ogg conversion failed:', err.message);
      // Continue with original file — will not be PTT but still playable
    }
  }

  if (env.R2_ENABLED && env.R2_PUBLIC_URL) {
    try {
      const ext = extFromMime(mimetype) || path.extname(filePath).slice(1) || 'bin';
      const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = readFileSync(filePath);
      await uploadToR2(buffer, key, mimetype);
      try { unlinkSync(filePath); } catch {}
      return res.json({ url: `${env.R2_PUBLIC_URL}/${key}`, key });
    } catch (err) {
      console.error('[upload] R2 failed, falling back to disk:', err.message);
    }
  }

  const base = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/uploads/${path.basename(filePath)}`, key: path.basename(filePath) });
}

const router = Router();

router.post('/upload', requireAuth, upload.single('file'), handleUpload);
router.post('/upload-public', requireAnyAuth, upload.single('file'), handleUpload);

// Génère une URL signée fraîche pour une clé R2 (pour les médias WhatsApp entrants)
router.get('/media/url', requireAnyAuth, async (req, res) => {
  const { key } = req.query;
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'KEY_REQUIRED' });
  if (key.startsWith('http')) return res.json({ url: key }); // déjà une URL publique
  try {
    const url = await getSignedMediaUrl(key, 3600);
    res.json({ url });
  } catch (err) {
    console.error('[media/url] erreur:', err.message);
    res.status(500).json({ error: 'MEDIA_ERROR' });
  }
});

export default router;
