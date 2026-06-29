import db from '../config/db.js';

/**
 * Assign a conversation to the least-loaded online agent.
 * Uses a PostgreSQL transaction with FOR UPDATE SKIP LOCKED so concurrent
 * calls never assign the same agent or the same conversation twice.
 *
 * Returns { agentId, agentName, delivery } on success, null otherwise.
 */
export async function assignToAvailableAgent(deliveryId) {
  try {
    return await db.transaction(async (trx) => {
      // Guard: conversation must still be unassigned and in the queue
      const delivery = await trx('deliveries')
        .where({ id: deliveryId, status: 'admin_queue' })
        .whereNull('claimed_by')
        .whereNull('archived_at')
        .first();

      if (!delivery) return null;

      // Least-Active-Conversations agent selection.
      // FOR UPDATE SKIP LOCKED prevents two concurrent transactions from
      // picking the same agent row.
      const { rows } = await trx.raw(`
        SELECT id, name
        FROM admins
        WHERE status = 'online'
        ORDER BY (
          SELECT COUNT(*)
          FROM deliveries d
          WHERE d.claimed_by = admins.id
            AND d.status = 'admin_queue'
        ) ASC,
        last_assigned_at ASC NULLS FIRST
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      const agent = rows[0];
      if (!agent) return null;

      // Assign the conversation (WHERE claimed_by IS NULL is the final safety net)
      const [assigned] = await trx('deliveries')
        .where({ id: deliveryId, status: 'admin_queue' })
        .whereNull('claimed_by')
        .update({ claimed_by: agent.id, claimed_at: trx.fn.now() })
        .returning('*');

      if (!assigned) return null;

      // Update round-robin fairness timestamp
      await trx('admins')
        .where({ id: agent.id })
        .update({ last_assigned_at: trx.fn.now() });

      return { agentId: agent.id, agentName: agent.name, delivery: assigned };
    });
  } catch (err) {
    console.error('[autoAssign] assignToAvailableAgent error:', err.message);
    return null;
  }
}

/**
 * Drain the unassigned queue in FIFO order.
 * Stops as soon as no more online agents are available.
 * onAssigned(result) is called for each successful assignment.
 */
export async function processQueue(onAssigned) {
  const pending = await db('deliveries')
    .where({ status: 'admin_queue' })
    .whereNull('claimed_by')
    .whereNull('archived_at')
    .orderBy('created_at', 'asc');

  for (const conv of pending) {
    const result = await assignToAvailableAgent(conv.id);
    if (!result) break; // No more online agents
    if (onAssigned) await onAssigned(result).catch(() => {});
  }
}

/**
 * Release all conversations held by an agent (on disconnect / going offline),
 * then immediately try to reassign them to remaining online agents.
 * Returns the array of released delivery IDs.
 */
export async function releaseAndReassign(adminId, onAssigned) {
  const released = await db('deliveries')
    .where({ claimed_by: adminId, status: 'admin_queue' })
    .update({ claimed_by: null, claimed_at: null })
    .returning('id');

  const releasedIds = released.map((r) => r.id);
  if (!releasedIds.length) return releasedIds;

  // Reassign in FIFO order
  const convs = await db('deliveries')
    .whereIn('id', releasedIds)
    .orderBy('created_at', 'asc');

  for (const conv of convs) {
    const result = await assignToAvailableAgent(conv.id);
    if (result && onAssigned) await onAssigned(result).catch(() => {});
  }

  return releasedIds;
}
