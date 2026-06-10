export async function up(knex) {
  await knex.raw(`
    ALTER TABLE cc_driver_messages
      ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text'
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE cc_driver_messages DROP COLUMN IF EXISTS type`);
}
