export async function up(knex) {
  await knex.raw(`
    ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS phone TEXT
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE drivers DROP COLUMN IF EXISTS phone`);
}
