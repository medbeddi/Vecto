/**
 * Dispatch prioritaire : la course s'affiche d'abord au livreur le plus proche,
 * puis à tous les autres après expiration de la fenêtre prioritaire.
 */
export async function up(db) {
  await db.schema.alterTable('deliveries', (table) => {
    table.uuid('nearest_driver_id').nullable().references('id').inTable('drivers').onDelete('SET NULL');
    table.timestamp('priority_expires_at', { useTz: true }).nullable();
  });
}

export async function down(db) {
  await db.schema.alterTable('deliveries', (table) => {
    table.dropColumn('nearest_driver_id');
    table.dropColumn('priority_expires_at');
  });
}
