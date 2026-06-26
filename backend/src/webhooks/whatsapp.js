import { Router } from 'express';
import { createHmac } from 'crypto';
import { randomInt } from 'crypto';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId, encryptWaId, sanitizeText } from '../services/pii-filter.js';
import { downloadFromMeta, uploadToR2WithRetry, extFromMime } from '../services/media.js';
import { getActiveDelivery, createAdminQueueDelivery } from '../services/delivery.js';
import { emitClientMessage, emitIncomingCall, emitIncomingText, emitNewOrder, emitMessageReaction } from '../services/socket.js';
import { notifyAssignedDriver } from '../services/fcm.js';
import { sendText } from '../services/messaging.js';
import { transcribeAndAnalyze, containsOffensiveWords } from '../services/transcription.js';

const router = Router();

// ─── GET : vérification du webhook par Meta ────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WA_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── POST : réception des messages WhatsApp ────────────────────────────────────
router.post('/', (req, res) => {
  if (env.WA_APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'];
    const expected = 'sha256=' + createHmac('sha256', env.WA_APP_SECRET)
      .update(req.rawBody ?? Buffer.from(JSON.stringify(req.body)))
      .digest('hex');
    if (!sig || sig !== expected) {
      console.warn('[webhook] signature HMAC invalide — requête rejetée');
      return res.sendStatus(403);
    }
  } else {
    console.error('[webhook] WA_APP_SECRET non configuré — requête rejetée');
    return res.sendStatus(403);
  }
  res.sendStatus(200);
  processPayload(req.body).catch((err) => {
    console.error('[webhook] erreur traitement', err.message);
  });
});

async function processPayload(body) {
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      if (Array.isArray(value.calls)) {
        for (const call of value.calls) {
          emitIncomingCall({
            callId:    call.id,
            from:      call.from?.replace(/\d/g, '*'),
            timestamp: call.timestamp,
          });
        }
        continue;
      }

      const messages = value.messages;
      if (!Array.isArray(messages)) continue;

      for (const msg of messages) {
        await processMessage(msg).catch((err) => {
          console.error(`[webhook] message id=${msg.id} erreur: ${err.message}`);
        });
      }
    }
  }
}

function mergeWaId(meta, waId) {
  const base = (meta && typeof meta === 'object') ? { ...meta } : {};
  base.waId = waId;
  return base;
}

async function processMessage(msg) {
  const rawWaId = msg.from;
  console.info(`[webhook] message reçu id=${msg.id} type=${msg.type} from=${rawWaId?.slice(-4)}`);

  // Idempotence : Meta peut retenter le webhook — ignorer les doublons
  const alreadyProcessed = await db('messages').whereRaw("meta->>'waId' = ?", [msg.id]).first('id');
  if (alreadyProcessed) {
    console.info(`[webhook] message id=${msg.id} déjà traité → ignoré`);
    return;
  }

  const waHash  = hashWaId(rawWaId);
  const waEnc   = encryptWaId(rawWaId);

  // Upsert client
  let client = await db('clients').where({ wa_id_hash: waHash }).first();
  if (!client) {
    const alias = generateAlias();
    [client] = await db('clients')
      .insert({ wa_id_hash: waHash, wa_id_enc: waEnc, alias })
      .returning('*');
  }

  const existing = await getActiveDelivery(client.id);
  const msgType  = msg.type;

  // ── Livraison en cours → message de chat vers livreur ────────────────────────
  if (existing && (existing.status === 'assigned' || existing.status === 'in_progress')) {
    // Réaction pendant la livraison → badge sur le message cible (pas un nouveau message)
    if (msgType === 'reaction') {
      const emoji   = msg.reaction?.emoji;
      const refWaId = msg.reaction?.message_id;
      if (!emoji || !refWaId) return;
      const originalMsg = await db('messages')
        .whereRaw("meta->>'waId' = ?", [refWaId])
        .first('id', 'delivery_id', 'meta');
      if (originalMsg) {
        const currentMeta = (originalMsg.meta && typeof originalMsg.meta === 'object') ? originalMsg.meta : {};
        const reactions = { ...(currentMeta.reactions || {}) };
        const users = reactions[emoji] || [];
        if (!users.includes('client')) reactions[emoji] = [...users, 'client'];
        const newMeta = { ...currentMeta, reactions };
        await db('messages').where({ id: originalMsg.id }).update({ meta: JSON.stringify(newMeta) });
        emitMessageReaction(existing.id, originalMsg.id, reactions);
      }
      return;
    }

    const { content, meta } = await extractContent(msg, existing.id);
    const [message] = await db('messages')
      .insert({ delivery_id: existing.id, sender_role: 'client', type: msgType, content, meta: JSON.stringify(mergeWaId(meta, msg.id)) })
      .returning('*');

    emitClientMessage(existing.id, message, existing.driver_id);
    const preview = msgType === 'text' ? (content?.slice(0, 80) ?? '') : `[${msgType}]`;
    notifyAssignedDriver(existing.driver_id, {
      title: '💬 Nouveau message',
      body: msgType === 'audio' ? 'Message vocal du client' : preview,
      data: { type: 'client_message', deliveryId: existing.id },
    }).catch(() => {});
    return;
  }

  // ── Message vocal : transcription → modération → livreurs ────────────────────
  if (msgType === 'audio') {
    const mediaId  = msg.audio?.id;
    const mimeType = msg.audio?.mime_type || 'audio/ogg';

    // Télécharger une seule fois pour transcription + upload R2
    let audioBuffer = null;
    try {
      const dl = await downloadFromMeta(mediaId);
      audioBuffer = dl.buffer;
    } catch (err) {
      console.warn('[webhook] audio download erreur:', err.message);
    }

    const { isEmpty, isOffensive } = await transcribeAndAnalyze(audioBuffer, mimeType);

    if (isEmpty) {
      console.info(`[webhook] audio vide (Whisper) → auto-réponse envoyée, pas de delivery créée`);
      sendText(rawWaId, 'Message vocal vide, veuillez réenvoyer votre demande.').catch(() => {});
      return;
    }
    if (isOffensive) {
      sendText(rawWaId, 'Attention : votre message contient des termes inappropriés. Merci de rester respectueux.').catch(() => {});
    }

    // Créer ou récupérer la delivery admin_queue (tout passe par l'admin d'abord)
    let delivery = existing?.status === 'admin_queue' ? existing : null;
    if (!delivery) delivery = await createAdminQueueDelivery(client.id);

    // Upload R2 avec retry automatique
    let audioContent = null;
    let audioMeta = { duration: msg.audio?.duration ?? null, metaMediaId: mediaId };
    if (audioBuffer) {
      try {
        const ext = extFromMime(mimeType);
        const key = `media/${delivery.id}/audio/${Date.now()}_${mediaId}.${ext}`;
        await uploadToR2WithRetry(audioBuffer, key, mimeType);
        audioContent = env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL}/${key}` : key;
        audioMeta.r2Key = key;
      } catch (err) {
        console.error('[webhook] audio R2 erreur après retry:', err.message);
        audioMeta.uploadFailed = true;
      }
    }

    const [message] = await db('messages')
      .insert({ delivery_id: delivery.id, sender_role: 'client', type: 'audio', content: audioContent, meta: JSON.stringify(mergeWaId(audioMeta, msg.id)) })
      .returning('*');

    emitIncomingText(delivery, message, client.alias);
    return;
  }

  // ── Message texte → call center (admin_queue) ─────────────────────────────────
  if (msgType === 'text') {
    const textBody = sanitizeText(msg.text?.body);

    if (containsOffensiveWords(textBody)) {
      sendText(rawWaId, 'Attention : votre message contient des termes inappropriés. Merci de rester respectueux.').catch(() => {});
    }

    let delivery = existing?.status === 'admin_queue' ? existing : null;
    if (!delivery) {
      delivery = await createAdminQueueDelivery(client.id);
      console.info(`[webhook] delivery admin_queue créée id=${delivery.id} client=${client.alias}`);
    } else {
      console.info(`[webhook] delivery admin_queue existante id=${delivery.id} client=${client.alias}`);
    }

    const [message] = await db('messages')
      .insert({ delivery_id: delivery.id, sender_role: 'client', type: 'text', content: textBody, meta: JSON.stringify({ waId: msg.id }) })
      .returning('*');

    console.info(`[webhook] message texte sauvegardé id=${message.id} → emitIncomingText`);
    emitIncomingText(delivery, message, client.alias);
    return;
  }

  // ── Réaction emoji native WhatsApp → badge sur le message cible ──────────────
  if (msgType === 'reaction') {
    const emoji   = msg.reaction?.emoji;
    const refWaId = msg.reaction?.message_id;
    if (!emoji) return; // emoji vide = suppression de réaction, on ignore

    if (refWaId) {
      const originalMsg = await db('messages')
        .whereRaw("meta->>'waId' = ?", [refWaId])
        .first('id', 'delivery_id', 'meta');

      if (originalMsg) {
        const currentMeta = (originalMsg.meta && typeof originalMsg.meta === 'object') ? originalMsg.meta : {};
        const reactions = { ...(currentMeta.reactions || {}) };
        const users = reactions[emoji] || [];
        if (!users.includes('client')) {
          reactions[emoji] = [...users, 'client'];
        }
        const newMeta = { ...currentMeta, reactions };
        await db('messages').where({ id: originalMsg.id }).update({ meta: JSON.stringify(newMeta) });
        emitMessageReaction(originalMsg.delivery_id, originalMsg.id, reactions);
        return;
      }
    }
    // Message original introuvable (message ancien sans waId) → on ignore silencieusement
    return;
  }

  // ── Autres types (image, location, etc.) ─────────────────────────────────────
  {
    let delivery = existing?.status === 'admin_queue' ? existing
      : existing?.status === 'pending' ? existing
      : null;

    if (!delivery) delivery = await createAdminQueueDelivery(client.id);

    const { content, meta } = await extractContent(msg, delivery.id);
    const [message] = await db('messages')
      .insert({ delivery_id: delivery.id, sender_role: 'client', type: msgType, content, meta: JSON.stringify(mergeWaId(meta, msg.id)) })
      .returning('*');

    if (delivery.status === 'admin_queue') {
      emitIncomingText(delivery, message, client.alias);
    } else if (delivery.status === 'pending') {
      emitNewOrder({ ...delivery, alias: client.alias }, message);
    }
  }
}

// ─── Extraction du contenu selon le type ──────────────────────────────────────
async function extractContent(msg, deliveryId) {
  switch (msg.type) {
    case 'text':
      return { content: sanitizeText(msg.text?.body), meta: null };

    case 'audio':
    case 'image': {
      const mediaId  = msg[msg.type]?.id;
      const mimeType = msg[msg.type]?.mime_type || 'application/octet-stream';
      try {
        const { buffer } = await downloadFromMeta(mediaId);
        const ext = extFromMime(mimeType);
        const key = `media/${deliveryId}/${msg.type}/${Date.now()}_${mediaId}.${ext}`;
        await uploadToR2WithRetry(buffer, key, mimeType);
        const content = env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL}/${key}` : key;
        const meta = msg.type === 'audio'
          ? { duration: msg.audio?.duration ?? null, r2Key: key }
          : { r2Key: key };
        return { content, meta };
      } catch (err) {
        console.error(`[webhook] media ${msg.type} non stocké après retry: ${err.message}`);
        return { content: null, meta: { raw_type: msg.type, metaMediaId: mediaId, uploadFailed: true } };
      }
    }

    case 'location': {
      const loc = msg.location ?? {};
      return { content: null, meta: { lat: loc.latitude, lng: loc.longitude, label: loc.name || loc.address || null } };
    }

    default:
      return { content: null, meta: { raw_type: msg.type } };
  }
}

// ─── Générateur d'alias anonymes ──────────────────────────────────────────────
const ALIAS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateAlias() {
  let code = '';
  for (let i = 0; i < 5; i++) code += ALIAS_CHARS[randomInt(ALIAS_CHARS.length)];
  return `Client #${code}`;
}

export default router;
