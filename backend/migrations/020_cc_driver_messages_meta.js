export async function up(knex) {
  await knex.raw(`
    ALTER TABLE cc_driver_messages
      ADD COLUMN IF NOT EXISTS meta JSONB
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE cc_driver_messages DROP COLUMN IF EXISTS meta`);
}
