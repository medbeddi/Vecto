import db from '../config/db.js';
import { decryptWaId } from './pii-filter.js';
import { sendText, sendAudio, sendImage, sendLocation } from './messaging.js';
import { emitDriverMessage } from './socket.js';

// Point d'entrée unique pour le relay driver → client WhatsApp.
// waId est décrypté ici et n'existe que le temps de l'appel réseau.
export async function relayDriverMessage(deliveryId, driverId, { type, content, meta }) {
  const delivery = await db('deliveries')
    .where({ id: deliveryId, driver_id: driverId })
    .whereIn('status', ['assigned', 'in_progress'])
    .first();

  if (!delivery) {
    throw Object.assign(new Error('Course introuvable ou non assignée'), {
      code: 'DELIVERY_NOT_FOUND',
    });
  }

  const client = await db('clients')
    .where({ id: delivery.client_id })
    .first('wa_id_enc');

  if (!client) {
    throw Object.assign(new Error('Client introuvable'), { code: 'CLIENT_NOT_FOUND' });
  }

  // Sauvegarder d'abord — le message doit apparaître même si WhatsApp échoue
  const [message] = await db('messages')
    .insert({
      delivery_id: deliveryId,
      sender_role: 'driver',
      type,
      content: type !== 'location' ? (content ?? null) : null,
      meta: meta ?? null,
    })
    .returning('*');

  emitDriverMessage(deliveryId, message);

  // Relay WhatsApp en best-effort (ne bloque pas la réponse driver)
  const waId = decryptWaId(client.wa_id_enc);
  dispatch(waId, type, content, meta).catch((err) =>
    console.error('[relay] WhatsApp échoué deliveryId=%s err=%s', deliveryId, err.message)
  );

  return { delivery, message };
}

async function dispatch(waId, type, content, meta) {
  switch (type) {
    case 'text':
      return sendText(waId, content);
    case 'audio':
      return sendAudio(waId, content); // content = clé R2
    case 'image':
      return sendImage(waId, content); // content = clé R2
    case 'location':
      return sendLocation(waId, meta?.lat, meta?.lng, meta?.label ?? '');
    default:
      throw Object.assign(new Error(`Type non supporté : ${type}`), {
        code: 'UNSUPPORTED_TYPE',
      });
  }
}
