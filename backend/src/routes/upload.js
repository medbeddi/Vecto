import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { requireAuth } from '../middleware/auth.js';
import { uploadToR2, extFromMime } from '../services/media.js';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const memStorage = multer.memoryStorage();
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ['audio/', 'image/'];
  if (allowed.some((t) => file.mimetype.startsWith(t))) cb(null, true);
  else cb(new Error('Type de fichier non supporté'));
};

const upload = multer({
  storage: env.R2_ENABLED ? memStorage : diskStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter,
});

async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

  if (env.R2_ENABLED) {
    try {
      const ext = extFromMime(req.file.mimetype) || path.extname(req.file.originalname).slice(1) || 'bin';
      const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      await uploadToR2(req.file.buffer, key, req.file.mimetype);
      const url = `${env.R2_PUBLIC_URL}/${key}`;
      return res.json({ url, key });
    } catch (err) {
      console.error('[upload] R2 error:', err.message);
      return res.status(500).json({ error: 'UPLOAD_FAILED' });
    }
  }

  const host = `${req.protocol}://${req.headers.host}`;
  res.json({ url: `${host}/uploads/${req.file.filename}`, key: req.file.filename });
}

const router = Router();

router.post('/upload', requireAuth, upload.single('file'), handleUpload);
router.post('/upload-public', upload.single('file'), handleUpload);

export default router;
