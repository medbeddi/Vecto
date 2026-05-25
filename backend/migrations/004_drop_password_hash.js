export async function up(knex) {
  await knex.raw(`ALTER TABLE drivers ALTER COLUMN password_hash DROP NOT NULL`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE drivers ALTER COLUMN password_hash SET NOT NULL`);
}
