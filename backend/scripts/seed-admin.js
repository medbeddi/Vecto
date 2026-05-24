import '../src/config/env.js';
import bcrypt from 'bcrypt';
import db from '../src/config/db.js';

const admin = { name: 'Admin Vecto', email: 'admin@vecto.app', password: 'admin123' };

const hash = await bcrypt.hash(admin.password, 12);
const [row] = await db('admins')
  .insert({ name: admin.name, email: admin.email, password_hash: hash })
  .onConflict('email').merge({ name: admin.name })
  .returning(['id', 'name', 'email']);

console.log(`✓ Admin : ${row.name} | ${row.email} | mot de passe : ${admin.password}`);
await db.destroy();
