import knex from 'knex';
import { env } from './env.js';

const db = knex({
  client: 'pg',
  connection: env.DATABASE_URL,
  pool: { min: 2, max: 10 },
  acquireConnectionTimeout: 10000,
});

export default db;
