import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import db from '../config/db.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'TOKEN_MISSING' });
  }

  const token = header.slice(7);
  try {
    req.driver = jwt.verify(token, env.JWT_SECRET);

    const driver = await db('drivers').where({ id: req.driver.id }).first('suspended');
    if (!driver || driver.suspended) {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    }

    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    res.status(401).json({ error: code });
  }
}
