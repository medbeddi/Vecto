export async function up(knex) {
  // Allow negative balance (remove the >= 0 constraint)
  await knex.raw(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_check`);

  // Add commission and threshold settings
  await knex.raw(`
    INSERT INTO app_settings (key, value) VALUES
      ('commission_par_course',  '5'),
      ('wallet_seuil_blocage',   '60')
    ON CONFLICT (key) DO NOTHING
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE wallets ADD CONSTRAINT wallets_balance_check CHECK (balance >= 0)`);
  await knex.raw(`DELETE FROM app_settings WHERE key IN ('commission_par_course', 'wallet_seuil_blocage')`);
}
