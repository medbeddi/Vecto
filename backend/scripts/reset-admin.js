import '../src/config/env.js';
import bcrypt from 'bcrypt';
import db from '../src/config/db.js';

const EMAIL    = 'admin@vecto.app';
const PASSWORD = 'Admin2026!';

async function run() {
  const hash = await bcrypt.hash(PASSWORD, 12);

  const existing = await db('admins').where({ email: EMAIL }).first();
  if (existing) {
    await db('admins').where({ email: EMAIL }).update({ password_hash: hash });
    console.log(`✓ Mot de passe mis à jour pour ${EMAIL}`);
  } else {
    await db('admins').insert({ name: 'Admin', email: EMAIL, password_hash: hash });
    console.log(`✓ Admin créé : ${EMAIL}`);
  }

  // Lister tous les comptes admin
  const all = await db('admins').select('id', 'name', 'email', 'created_at');
  console.log('\nComptes admin existants :');
  all.forEach(a => console.log(`  - ${a.email}  (nom: ${a.name})`));

  await db.destroy();
}

run().catch(err => { console.error(err.message); process.exit(1); });
