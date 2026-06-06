export async function up(knex) {
  // Ajouter 'admin' dans sender_role pour les réponses du call center
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_role_check`);
  await knex.raw(`ALTER TABLE messages ADD CONSTRAINT messages_sender_role_check CHECK (sender_role IN ('client', 'driver', 'admin'))`);

  // Élargir les types de messages acceptés (sticker, document, reaction, etc.)
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check`);
  await knex.raw(`ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'audio', 'image', 'location', 'sticker', 'document', 'reaction', 'other'))`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_role_check`);
  await knex.raw(`ALTER TABLE messages ADD CONSTRAINT messages_sender_role_check CHECK (sender_role IN ('client', 'driver'))`);
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check`);
  await knex.raw(`ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'audio', 'image', 'location'))`);
}
