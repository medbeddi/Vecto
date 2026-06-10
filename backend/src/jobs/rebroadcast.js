import db from '../config/db.js';
import { emitNewOrder } from '../services/socket.js';

// deliveryId → timestamp of last re-broadcast
const lastBroadcast = new Map();

async function tick() {
  const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
  try {
    const rows = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where('deliveries.status', 'pending')
      .where('deliveries.created_at', '<', threeMinAgo)
      .select('deliveries.*', 'clients.alias');

    for (const row of rows) {
      const last = lastBroadcast.get(row.id);
      if (last && Date.now() - last < 3 * 60 * 1000) continue;

      const initialMessage = {
        type:    row.initial_media_type || 'text',
        content: row.initial_media_url  || row.description || row.pickup_address || '',
        meta:    null,
      };

      emitNewOrder(row, initialMessage).catch((e) =>
        console.error('[rebroadcast] emit failed:', e.message)
      );

      lastBroadcast.set(row.id, Date.now());
      console.info(`[rebroadcast] delivery ${row.id} re-broadcast`);
    }
  } catch (err) {
    console.error('[rebroadcast] tick error:', err.message);
  }
}

export function startRebroadcastJob() {
  setInterval(tick, 30 * 1000);
}
