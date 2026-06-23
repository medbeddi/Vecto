import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'TOKEN_MISSING' });
  }

  const token = header.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({ error: code });
  }

  try {
    req.driver = decoded;
    const driver = await db('drivers').where({ id: req.driver.id }).first('suspended');
    if (!driver || driver.suspended) {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    }
    next();
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
}
