export async function up(knex) {
  // Remplace la commission fixe par un pourcentage du prix de livraison
  await knex.raw(`
    INSERT INTO app_settings (key, value)
    VALUES ('commission_pourcentage', '15')
    ON CONFLICT (key) DO NOTHING
  `);
  await knex.raw(`DELETE FROM app_settings WHERE key = 'commission_par_course'`);
}

export async function down(knex) {
  await knex.raw(`
    INSERT INTO app_settings (key, value)
    VALUES ('commission_par_course', '5')
    ON CONFLICT (key) DO NOTHING
  `);
  await knex.raw(`DELETE FROM app_settings WHERE key = 'commission_pourcentage'`);
}
