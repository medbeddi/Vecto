import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function requireClientAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.role !== 'client') return res.status(403).json({ error: 'FORBIDDEN' });
    req.client = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_INVALID' });
  }
}
