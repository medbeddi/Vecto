import db from '../config/db.js';
import { emitNewOrder } from '../services/socket.js';

async function tick() {
  const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
  try {
    const rows = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.status', 'pending')
      .where('deliveries.last_broadcast_at', '<', threeMinAgo)
      .select('deliveries.*', 'clients.alias');

    for (const row of rows) {
      // Mettre à jour last_broadcast_at en DB (source de vérité pour le compteur)
      const [updated] = await db('deliveries')
        .where({ id: row.id })
        .update({ last_broadcast_at: db.fn.now() })
        .returning(['last_broadcast_at']);

      row.last_broadcast_at = updated.last_broadcast_at;

      const initialMessage = {
        type:    row.initial_media_type || 'text',
        content: row.initial_media_url  || row.description || row.pickup_address || '',
        meta:    null,
      };

      emitNewOrder(row, initialMessage).catch((e) =>
        console.error('[rebroadcast] emit failed:', e.message)
      );

      console.info(`[rebroadcast] delivery ${row.id} re-broadcast`);
    }
  } catch (err) {
    console.error('[rebroadcast] tick error:', err.message);
  }
}

export function startRebroadcastJob() {
  setInterval(tick, 30 * 1000);
}
