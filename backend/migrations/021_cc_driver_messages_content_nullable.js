export async function up(knex) {
  await knex.raw(`
    ALTER TABLE cc_driver_messages ALTER COLUMN content DROP NOT NULL
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE cc_driver_messages ALTER COLUMN content SET NOT NULL
  `);
}
