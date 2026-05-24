export async function up(knex) {
  await knex.schema.createTable('otps', (t) => {
    t.increments('id').primary();
    t.string('phone_hash', 64).notNullable();
    t.string('code', 6).notNullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('used').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('phone_hash');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('otps');
}
