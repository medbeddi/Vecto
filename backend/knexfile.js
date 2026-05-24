import dotenv from 'dotenv';
dotenv.config();

export default {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    extension: 'js',
    loadExtensions: ['.js'],
  },
  pool: { min: 2, max: 10 },
};
