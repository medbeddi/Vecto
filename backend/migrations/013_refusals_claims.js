export async function up(knex) {
  // Verrouillage conversation CC : quel agent a pris en charge cette conversation
  await knex.raw(`
    ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS claimed_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMP
  `);

  // Table des refus livreurs (un livreur ne revoit plus une course qu'il a refusée)
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS delivery_refusals (
      id          SERIAL PRIMARY KEY,
      delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      driver_id   UUID NOT NULL REFERENCES drivers(id)   ON DELETE CASCADE,
      created_at  TIMESTAMP DEFAULT NOW(),
      UNIQUE(delivery_id, driver_id)
    )
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS delivery_refusals`);
  await knex.raw(`ALTER TABLE deliveries DROP COLUMN IF EXISTS claimed_by, DROP COLUMN IF EXISTS claimed_at`);
}
