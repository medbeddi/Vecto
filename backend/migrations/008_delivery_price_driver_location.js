export async function up(knex) {
  // Prix de la livraison (fixé par l'admin avant d'envoyer aux livreurs)
  await knex.raw(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price NUMERIC(10,2)`);

  // Dernière position GPS connue du livreur
  await knex.raw(`
    ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS last_lat  DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS last_lng  DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE deliveries DROP COLUMN IF EXISTS price`);
  await knex.raw(`
    ALTER TABLE drivers
      DROP COLUMN IF EXISTS last_lat,
      DROP COLUMN IF EXISTS last_lng,
      DROP COLUMN IF EXISTS last_seen
  `);
}
