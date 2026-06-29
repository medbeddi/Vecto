export async function up(knex) {
  await knex.schema.table('admins', (t) => {
    t.string('status', 20).notNullable().defaultTo('offline');
    t.timestamp('last_assigned_at', { useTz: true }).nullable().defaultTo(null);
  });

  await knex.raw(`
    ALTER TABLE admins
      ADD CONSTRAINT admins_status_check
      CHECK (status IN ('online', 'offline', 'break'))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS admins_status_idx ON admins (status)
    WHERE status = 'online'
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_status_check`);
  await knex.raw(`DROP INDEX IF EXISTS admins_status_idx`);
  await knex.schema.table('admins', (t) => {
    t.dropColumn('status');
    t.dropColumn('last_assigned_at');
  });
}
