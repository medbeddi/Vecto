/**
 * Simule un message WhatsApp entrant sans passer par Meta.
 * Usage :
 *   node scripts/test-webhook.js text    "Bonjour je veux commander"
 *   node scripts/test-webhook.js location
 *   node scripts/test-webhook.js audio
 *
 * Le WA_TOKEN et WA_PHONE_ID peuvent être factices pour ce test.
 */

import '../src/config/env.js';

const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

// Numéro de test fictif — sera haché avant tout stockage
const FAKE_WA_ID = '22236000099';
const MSG_TYPE   = process.argv[2] ?? 'text';
const TEXT_BODY  = process.argv[3] ?? 'Bonjour, je voudrais une livraison svp';

function buildPayload(type) {
  const base = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry_test_001',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: process.env.WA_PHONE_ID },
          messages: [buildMessage(type)],
        },
      }],
    }],
  };
  return base;
}

function buildMessage(type) {
  const id = `wamid.test_${Date.now()}`;
  const from = FAKE_WA_ID;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  switch (type) {
    case 'text':
      return { id, from, timestamp, type: 'text', text: { body: TEXT_BODY } };

    case 'location':
      return {
        id, from, timestamp, type: 'location',
        location: { latitude: 18.0735, longitude: -15.9582, name: 'Marché Capitale', address: 'Nouakchott' },
      };

    case 'audio':
      // Meta ne fournit qu'un media_id — le webhook tentera un download (échouera en test local)
      return {
        id, from, timestamp, type: 'audio',
        audio: { id: 'fake_media_id_001', mime_type: 'audio/ogg; codecs=opus' },
      };

    default:
      throw new Error(`Type inconnu : ${type}. Utiliser : text | location | audio`);
  }
}

async function run() {
  const payload = buildPayload(MSG_TYPE);

  console.log(`\n📤 Envoi webhook simulé — type: ${MSG_TYPE}`);
  console.log('   Payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(`${BASE}/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`\n📥 Réponse Meta (doit être 200) : ${res.status}`);

  // Attendre le traitement async du webhook
  await new Promise(r => setTimeout(r, 1500));

  // Vérifier que le message a été créé en base
  const { default: db } = await import('../src/config/db.js');

  const client = await db('clients').orderBy('created_at', 'desc').first();
  const delivery = client
    ? await db('deliveries').where({ client_id: client.id }).orderBy('created_at', 'desc').first()
    : null;
  const messages = delivery
    ? await db('messages').where({ delivery_id: delivery.id }).orderBy('created_at', 'asc')
    : [];

  console.log('\n─── Résultat en base ─────────────────────────────────');
  console.log(`Client  : ${client?.alias ?? '✗ non créé'} (id: ${client?.id ?? '-'})`);
  console.log(`Delivery: ${delivery?.status ?? '✗ non créée'} (id: ${delivery?.id ?? '-'})`);
  console.log(`Messages: ${messages.length}`);
  messages.forEach(m =>
    console.log(`  [${m.sender_role}] ${m.type}: ${m.content ?? JSON.stringify(m.meta)}`)
  );
  console.log('──────────────────────────────────────────────────────\n');

  await db.destroy();
}

run().catch(err => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
