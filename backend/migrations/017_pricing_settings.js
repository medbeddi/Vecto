export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await knex.raw(`
    INSERT INTO app_settings (key, value) VALUES
      ('tarif_base_km',      '3'),
      ('tarif_base_prix',    '100'),
      ('tarif_par_km_supp',  '20')
    ON CONFLICT (key) DO NOTHING
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS app_settings`);
}
