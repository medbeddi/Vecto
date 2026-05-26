import { Router } from 'express';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { hashWaId, encryptWaId, sanitizeText } from '../services/pii-filter.js';
import { downloadFromMeta, uploadToR2, extFromMime, getSignedMediaUrl } from '../services/media.js';
import { getActiveDelivery, createDelivery } from '../services/delivery.js';
import { emitNewOrder, emitClientMessage, emitIncomingCall } from '../services/socket.js';
import { notifyAvailableDrivers, notifyAssignedDriver } from '../services/fcm.js';

const router = Router();

// ─── GET : vérification du webhook par Meta ────────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WA_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── POST : réception des messages WhatsApp ────────────────────────────────────
router.post('/', (req, res) => {
  // Répondre 200 immédiatement (Meta abandonne si > 20s)
  res.sendStatus(200);

  // Traitement asynchrone découplé de la réponse HTTP
  processPayload(req.body).catch((err) => {
    console.error('[webhook] erreur traitement', err.message);
  });
});

async function processPayload(body) {
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // Appels entrants → notifier l'admin
      if (Array.isArray(value.calls)) {
        for (const call of value.calls) {
          emitIncomingCall({
            callId: call.id,
            from: call.from?.replace(/\d/g, '*'), // masquer le numéro
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

async function processMessage(msg) {
  const rawWaId = msg.from; // Dernier point de contact avec le numéro en clair

  // ── Anonymisation immédiate : plus jamais de `rawWaId` après ces 2 lignes ──
  const waHash = hashWaId(rawWaId);
  const waEnc = encryptWaId(rawWaId);
  // rawWaId doit disparaître du scope ici — ne pas le passer en argument

  // Upsert client : on ne crée l'alias qu'une seule fois
  let client = await db('clients').where({ wa_id_hash: waHash }).first();
  if (!client) {
    const alias = generateAlias();
    [client] = await db('clients')
      .insert({ wa_id_hash: waHash, wa_id_enc: waEnc, alias })
      .returning('*');
  }

  // Delivery active (pending ou assigned) ou nouvelle delivery
  let delivery = await getActiveDelivery(client.id);
  const isNew = !delivery;
  if (isNew) {
    delivery = await createDelivery(client.id);
  }

  // Traitement du contenu selon le type de message
  const { content, meta } = await extractContent(msg, delivery.id);

  // Sauvegarde en base
  const [message] = await db('messages')
    .insert({
      delivery_id: delivery.id,
      sender_role: 'client',
      type: msg.type,
      content,
      meta: meta ?? null,
    })
    .returning('*');

  // Injection de l'alias pour l'event socket (sans exposer le client_id aux livreurs)
  message.alias = client.alias;

  // Emission Socket.IO + FCM (FCM = backup si livreur pas connecté au socket)
  const deliveryWithAlias = { ...delivery, alias: client.alias };

  if (delivery.status === 'pending') {
    emitNewOrder(deliveryWithAlias, message);
    notifyAvailableDrivers(deliveryWithAlias).catch(() => {});
  } else if (delivery.status === 'assigned') {
    emitClientMessage(delivery.id, message);
    const preview = msg.type === 'text'
      ? (message.content?.slice(0, 80) ?? '')
      : `[${msg.type}]`;
    notifyAssignedDriver(delivery.driver_id, {
      title: `Message de ${client.alias}`,
      body: preview,
      data: { type: 'client_message', deliveryId: delivery.id },
    }).catch(() => {});
  }
}

// ─── Extraction du contenu selon le type ──────────────────────────────────────

async function extractContent(msg, deliveryId) {
  switch (msg.type) {
    case 'text': {
      return { content: sanitizeText(msg.text?.body), meta: null };
    }

    case 'audio':
    case 'image': {
      try {
        const mediaId = msg[msg.type]?.id;
        const mimeType = msg[msg.type]?.mime_type || 'application/octet-stream';

        const { buffer } = await downloadFromMeta(mediaId);
        const ext = extFromMime(mimeType);
        const key = `media/${deliveryId}/${msg.type}/${Date.now()}_${mediaId}.${ext}`;

        await uploadToR2(buffer, key, mimeType);
        const signedUrl = await getSignedMediaUrl(key);

        const meta = msg.type === 'audio'
          ? { duration: msg.audio?.duration ?? null, r2Key: key }
          : { r2Key: key };

        return { content: signedUrl, meta };
      } catch (err) {
        // R2 non configuré ou erreur réseau — on passe en mode texte dégradé
        console.warn(`[webhook] media ${msg.type} non stocké: ${err.message}`);
        return { content: null, meta: { raw_type: msg.type } };
      }
    }

    case 'location': {
      const loc = msg.location ?? {};
      return {
        content: null,
        meta: {
          lat: loc.latitude,
          lng: loc.longitude,
          label: loc.name || loc.address || null,
        },
      };
    }

    default:
      return { content: null, meta: { raw_type: msg.type } };
  }
}

// ─── Générateur d'alias anonymes ──────────────────────────────────────────────

const ALIAS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1

function generateAlias() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += ALIAS_CHARS[Math.floor(Math.random() * ALIAS_CHARS.length)];
  }
  return `Client #${code}`;
}

export default router;
