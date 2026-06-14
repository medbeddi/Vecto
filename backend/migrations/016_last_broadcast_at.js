export async function up(knex) {
  await knex.raw(`
    ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS last_broadcast_at TIMESTAMPTZ
  `);
  await knex.raw(`
    UPDATE deliveries SET last_broadcast_at = created_at
    WHERE last_broadcast_at IS NULL
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE deliveries DROP COLUMN IF EXISTS last_broadcast_at`);
}
