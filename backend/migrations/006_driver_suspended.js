export async function up(knex) {
  await knex.raw(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE NOT NULL`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE drivers DROP COLUMN IF EXISTS suspended`);
}
