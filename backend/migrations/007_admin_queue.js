export async function up(knex) {
  // Étendre le CHECK de status pour inclure admin_queue
  await knex.raw(`ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check`);
  await knex.raw(`
    ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
      CHECK (status IN ('pending','assigned','in_progress','done','cancelled','admin_queue'))
  `);

  // Colonnes adresses et coordonnées pour le lancement via call center
  await knex.raw(`
    ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS pickup_address  TEXT,
      ADD COLUMN IF NOT EXISTS dropoff_address TEXT,
      ADD COLUMN IF NOT EXISTS pickup_lat      DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS pickup_lng      DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS dropoff_lat     DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS dropoff_lng     DOUBLE PRECISION
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check`);
  await knex.raw(`
    ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
      CHECK (status IN ('pending','assigned','in_progress','done','cancelled'))
  `);
  await knex.raw(`
    ALTER TABLE deliveries
      DROP COLUMN IF EXISTS pickup_address,
      DROP COLUMN IF EXISTS dropoff_address,
      DROP COLUMN IF EXISTS pickup_lat,
      DROP COLUMN IF EXISTS pickup_lng,
      DROP COLUMN IF EXISTS dropoff_lat,
      DROP COLUMN IF EXISTS dropoff_lng
  `);
}
