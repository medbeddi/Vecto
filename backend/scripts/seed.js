// Crée des livreurs de test en base.
// Usage : node scripts/seed.js
//
// Prérequis : .env configuré + migrations appliquées

import '../src/config/env.js'; // charge dotenv + valide les vars
import bcrypt from 'bcrypt';
import db from '../src/config/db.js';
import { hashWaId } from '../src/services/pii-filter.js';

const DRIVERS = [
  { name: 'Ahmed Al-Amine', phone: '+22236000001', password: 'livreur123' },
  { name: 'Mohamed Lemine', phone: '+22236000002', password: 'livreur123' },
  { name: 'Fatima Mint Salem', phone: '+22236000003', password: 'livreur456' },
];

async function seed() {
  console.log('Seeding livreurs...\n');

  for (const d of DRIVERS) {
    const phoneHash = hashWaId(d.phone);
    const passwordHash = await bcrypt.hash(d.password, 12);

    const [driver] = await db('drivers')
      .insert({ name: d.name, phone_hash: phoneHash, password_hash: passwordHash, status: 'offline' })
      .onConflict('phone_hash')
      .merge({ name: d.name }) // met à jour le nom si déjà existant
      .returning(['id', 'name']);

    console.log(`  ✓ ${driver.name}  (id: ${driver.id})`);
    console.log(`    téléphone : ${d.phone}`);
    console.log(`    mot de passe : ${d.password}\n`);
  }

  await db.destroy();
  console.log('Seed terminé.');
}

seed().catch((err) => {
  console.error('Seed échoué :', err.message);
  process.exit(1);
});
