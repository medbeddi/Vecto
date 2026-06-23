import '../src/config/env.js';
import bcrypt from 'bcrypt';
import db from '../src/config/db.js';

const password = process.env.ADMIN_PASSWORD || process.argv[2];
if (!password) {
  console.error('Erreur : mot de passe requis. Utiliser ADMIN_PASSWORD=xxx ou passer en argument.');
  process.exit(1);
}

const name = 'Admin Vecto';
const email = 'admin@vecto.app';
const hash = await bcrypt.hash(password, 12);

const [row] = await db('admins')
  .insert({ name, email, password_hash: hash })
  .onConflict('email').merge({ name })
  .returning(['id', 'name', 'email']);

console.log(`✓ Admin : ${row.name} | ${row.email}`);
await db.destroy();
