export async function up(knex) {
  await knex.raw(`
    CREATE TABLE wallets (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id  UUID UNIQUE NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      balance    NUMERIC(10,2) DEFAULT 0 NOT NULL CHECK (balance >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE wallet_transactions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id   UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      amount      NUMERIC(10,2) NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('recharge', 'commission', 'bonus', 'withdrawal')),
      description TEXT,
      status      TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Créer un wallet pour chaque driver existant
  await knex.raw(`
    INSERT INTO wallets (driver_id)
    SELECT id FROM drivers
    ON CONFLICT (driver_id) DO NOTHING
  `);
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS wallet_transactions');
  await knex.raw('DROP TABLE IF EXISTS wallets');
}
