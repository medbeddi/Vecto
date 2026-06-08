export async function up(knex) {
  await knex.schema.createTable('cc_driver_messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
    t.text('sender_role').notNullable();
    t.text('content').notNullable();
    t.boolean('read_by_driver').defaultTo(false);
    t.boolean('read_by_admin').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ON cc_driver_messages (driver_id, created_at)');
}

export async function down(knex) {
  await knex.schema.dropTable('cc_driver_messages');
}
