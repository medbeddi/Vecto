import db from './src/config/db.js';

await db.migrate.latest();
console.info('[migrate] migrations OK');

await import('./src/app.js');
