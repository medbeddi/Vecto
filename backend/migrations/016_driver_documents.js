export async function up(knex) {
  await knex.raw(`
    ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS photo_driver       TEXT,
      ADD COLUMN IF NOT EXISTS carte_grise_front  TEXT,
      ADD COLUMN IF NOT EXISTS carte_grise_back   TEXT,
      ADD COLUMN IF NOT EXISTS carte_identite_front TEXT,
      ADD COLUMN IF NOT EXISTS carte_identite_back  TEXT,
      ADD COLUMN IF NOT EXISTS matricule          TEXT,
      ADD COLUMN IF NOT EXISTS photo_vehicule     TEXT
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE drivers
      DROP COLUMN IF EXISTS photo_driver,
      DROP COLUMN IF EXISTS carte_grise_front,
      DROP COLUMN IF EXISTS carte_grise_back,
      DROP COLUMN IF EXISTS carte_identite_front,
      DROP COLUMN IF EXISTS carte_identite_back,
      DROP COLUMN IF EXISTS matricule,
      DROP COLUMN IF EXISTS photo_vehicule
  `);
}
