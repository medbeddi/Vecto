export async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // wa_id_hash : SHA-256+salt pour les lookups (jamais réversible)
  // wa_id_enc  : AES-256-GCM pour pouvoir envoyer des messages WA en retour
  await knex.raw(`
    CREATE TABLE clients (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wa_id_hash  TEXT UNIQUE NOT NULL,
      wa_id_enc   TEXT NOT NULL,
      alias       TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE drivers (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      phone_hash  TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      status      TEXT DEFAULT 'offline',
      fcm_token   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT drivers_status_check CHECK (status IN ('offline', 'available', 'busy'))
    )
  `);

  await knex.raw(`
    CREATE TABLE deliveries (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id    UUID REFERENCES clients(id),
      driver_id    UUID REFERENCES drivers(id),
      status       TEXT DEFAULT 'pending',
      description  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      assigned_at  TIMESTAMPTZ,
      done_at      TIMESTAMPTZ,
      CONSTRAINT deliveries_status_check
        CHECK (status IN ('pending', 'assigned', 'in_progress', 'done', 'cancelled'))
    )
  `);

  await knex.raw(`
    CREATE TABLE messages (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_id  UUID REFERENCES deliveries(id),
      sender_role  TEXT NOT NULL,
      type         TEXT NOT NULL,
      content      TEXT,
      meta         JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT messages_sender_role_check CHECK (sender_role IN ('client', 'driver')),
      CONSTRAINT messages_type_check CHECK (type IN ('text', 'audio', 'image', 'location'))
    )
  `);

  await knex.raw(`CREATE INDEX ON deliveries(status, created_at)`);
  await knex.raw(`CREATE INDEX ON messages(delivery_id, created_at)`);
  await knex.raw(`CREATE INDEX ON drivers(status) WHERE status = 'available'`);
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS messages CASCADE');
  await knex.raw('DROP TABLE IF EXISTS deliveries CASCADE');
  await knex.raw('DROP TABLE IF EXISTS drivers CASCADE');
  await knex.raw('DROP TABLE IF EXISTS clients CASCADE');
}
