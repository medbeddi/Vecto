import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';

import { mkdirSync } from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/', 'image/'];
    if (allowed.some((t) => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error('Type de fichier non supporté'));
  },
});

const router = Router();

// Upload livreur (JWT requis)
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  const host = `${req.protocol}://${req.headers.host}`;
  res.json({ url: `${host}/uploads/${req.file.filename}`, key: req.file.filename });
});

// Upload client (sans auth — dev uniquement)
router.post('/upload-public', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  const host = `${req.protocol}://${req.headers.host}`;
  res.json({ url: `${host}/uploads/${req.file.filename}`, key: req.file.filename });
});

export default router;
