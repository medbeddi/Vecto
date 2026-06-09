export async function up(knex) {
  await knex.raw(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE NOT NULL`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE drivers DROP COLUMN IF EXISTS is_available`);
}
