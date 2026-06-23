import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { uploadToR2, extFromMime } from '../services/media.js';
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

// Convert webm audio to ogg/opus (required by WhatsApp Cloud API)
function convertWebmToOgg(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.ogg');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '16k',
      '-ac', '1',       // mono (required for WhatsApp PTT voice notes)
      '-ar', '8000',    // 8kHz sample rate (native WhatsApp PTT format)
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

  // WhatsApp does not support audio/webm — convert to ogg/opus
  if (mimetype.startsWith('audio/webm')) {
    try {
      const oggPath = await convertWebmToOgg(filePath);
      try { unlinkSync(filePath); } catch {}
      filePath = oggPath;
      mimetype = 'audio/ogg';
    } catch (err) {
      console.error('[upload] webm→ogg conversion failed:', err.message);
      // continue with webm as fallback (will likely fail on WhatsApp side)
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

  const base = env.PUBLIC_URL;
  if (!base) return res.status(500).json({ error: 'PUBLIC_URL_NOT_CONFIGURED' });
  res.json({ url: `${base}/uploads/${path.basename(filePath)}`, key: path.basename(filePath) });
}

const router = Router();

router.post('/upload', requireAuth, upload.single('file'), handleUpload);
router.post('/upload-public', requireAnyAuth, upload.single('file'), handleUpload);

export default router;
