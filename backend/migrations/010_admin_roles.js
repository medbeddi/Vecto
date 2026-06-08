export async function up(knex) {
  await knex.raw(`ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  await knex.raw(`ALTER TABLE admins ADD COLUMN created_by UUID REFERENCES admins(id) ON DELETE SET NULL`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE admins DROP COLUMN IF EXISTS created_by`);
  await knex.raw(`ALTER TABLE admins DROP COLUMN IF EXISTS role`);
}
