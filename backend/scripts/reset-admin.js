import '../src/config/env.js';
import bcrypt from 'bcrypt';
import db from '../src/config/db.js';

const EMAIL = 'admin@vecto.app';
const password = process.env.ADMIN_PASSWORD || process.argv[2];

if (!password) {
  console.error('Erreur : mot de passe requis. Utiliser ADMIN_PASSWORD=xxx ou passer en argument.');
  process.exit(1);
}

async function run() {
  const hash = await bcrypt.hash(password, 12);

  const existing = await db('admins').where({ email: EMAIL }).first();
  if (existing) {
    await db('admins').where({ email: EMAIL }).update({ password_hash: hash });
    console.log(`✓ Mot de passe mis à jour pour ${EMAIL}`);
  } else {
    await db('admins').insert({ name: 'Admin', email: EMAIL, password_hash: hash });
    console.log(`✓ Admin créé : ${EMAIL}`);
  }

  const all = await db('admins').select('id', 'name', 'email', 'created_at');
  console.log('\nComptes admin existants :');
  all.forEach(a => console.log(`  - ${a.email}  (nom: ${a.name})`));

  await db.destroy();
}

run().catch(err => { console.error(err.message); process.exit(1); });
