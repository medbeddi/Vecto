export async function up(knex) {
  await knex.schema.table('deliveries', (t) => {
    t.timestamp('chat_session_started_at', { useTz: true }).nullable().defaultTo(null);
  });
}

export async function down(knex) {
  await knex.schema.table('deliveries', (t) => {
    t.dropColumn('chat_session_started_at');
  });
}
