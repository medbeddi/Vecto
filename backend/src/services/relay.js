import db from '../config/db.js';
import { decryptWaId } from './pii-filter.js';
import { sendText, sendAudio, sendImage, sendLocation } from './messaging.js';
import { sendSms, twilioEnabled } from './twilio.js';
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

  // Relay WhatsApp en best-effort — skip les pseudo-clients sans vrai numéro
  const waId = decryptWaId(client.wa_id_enc);
  if (!waId.startsWith('admin_call_')) {
    dispatch(waId, type, content, meta).catch(async (err) => {
      console.error('[relay] WhatsApp échoué deliveryId=%s err=%s', deliveryId, err.message);
      // Fallback SMS Twilio pour les clients hors fenêtre 24h WhatsApp
      await _smsFallback(waId, type, content).catch((e) =>
        console.error('[relay] SMS fallback échoué:', e.message)
      );
    });
  }

  return { delivery, message };
}

// Envoie un message texte automatique au client (statut de la course).
// Sauvegardé en DB pour être visible dans le chat livreur.
export async function sendStatusMessageToClient(deliveryId, text) {
  const delivery = await db('deliveries').where({ id: deliveryId }).first('client_id');
  if (!delivery) return;
  const client = await db('clients').where({ id: delivery.client_id }).first('wa_id_enc');
  if (!client) return;

  // Sauvegarder le message système en DB → visible dans le chat du livreur
  await db('messages').insert({
    delivery_id: deliveryId,
    sender_role: 'admin',
    type: 'text',
    content: text,
    meta: JSON.stringify({ for_driver: true, system: true }),
  });

  // Ignorer les pseudo-clients sans vrai numéro WhatsApp
  const waId = decryptWaId(client.wa_id_enc);
  if (waId.startsWith('admin_call_')) return;

  try {
    await sendText(waId, text);
  } catch (err) {
    console.error('[relay] sendStatus WhatsApp échoué deliveryId=%s err=%s', deliveryId, err.message);
    // Fallback SMS pour les nouveaux clients hors fenêtre 24h
    await _smsFallback(waId, 'text', text).catch((e) =>
      console.error('[relay] SMS fallback status échoué:', e.message)
    );
  }
}

// Texte de substitution pour les types non-texte relayés via SMS
async function _smsFallback(waId, type, content) {
  if (!twilioEnabled()) return;
  let text;
  switch (type) {
    case 'text':     text = content; break;
    case 'audio':    text = '🎤 Votre livreur vous a envoyé un message vocal. Ouvrez l\'app Vecto pour l\'écouter.'; break;
    case 'location': text = '📍 Votre livreur a partagé sa localisation. Ouvrez l\'app Vecto pour la voir.'; break;
    case 'image':    text = '📷 Votre livreur vous a envoyé une photo. Ouvrez l\'app Vecto pour la voir.'; break;
    default: return;
  }
  await sendSms(waId, text);
  console.info('[relay] SMS fallback envoyé (type=%s) waId=...%s', type, waId.slice(-4));
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
