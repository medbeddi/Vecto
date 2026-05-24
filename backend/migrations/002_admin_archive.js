export async function up(knex) {
  // Table admins (centre d'appel)
  await knex.raw(`
    CREATE TABLE admins (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Champs supplémentaires sur deliveries
  await knex.raw(`
    ALTER TABLE deliveries
      ADD COLUMN archived_at       TIMESTAMPTZ,
      ADD COLUMN initial_media_url TEXT,
      ADD COLUMN initial_media_type TEXT
  `);

  // Index pour accès rapide aux archives
  await knex.raw(`CREATE INDEX ON deliveries(archived_at) WHERE archived_at IS NOT NULL`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE deliveries DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS initial_media_url, DROP COLUMN IF EXISTS initial_media_type`);
  await knex.raw(`DROP TABLE IF EXISTS admins CASCADE`);
}
