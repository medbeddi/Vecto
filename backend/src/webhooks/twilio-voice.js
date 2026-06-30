import { Router } from 'express';
import twilio from 'twilio';
import { env } from '../config/env.js';
import db from '../config/db.js';
import { decryptWaId } from '../services/pii-filter.js';

const router = Router();

// ── TwiML : mettre l'appelant dans la conférence ──────────────────────────────
// Twilio appelle ce webhook pour chaque participant dès qu'il décroche.
// Les deux partis rejoignent la même conférence identifiée par ?conf=
router.post('/voice', (req, res) => {
  const conferenceId = req.query.conf || req.body.conf || 'default';

  // Valider la signature Twilio en production
  if (env.NODE_ENV === 'production' && env.TWILIO_AUTH_TOKEN) {
    const valid = twilio.validateRequest(
      env.TWILIO_AUTH_TOKEN,
      req.headers['x-twilio-signature'] || '',
      `${env.PUBLIC_URL}/webhooks/twilio/voice`,
      req.body,
    );
    if (!valid) return res.status(403).send('Invalid signature');
  }

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial();
  dial.conference(conferenceId, {
    beep: false,
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
    waitUrl: '',          // Pas de musique d'attente
    maxParticipants: 3,   // Client + Livreur + CC possible
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// ── Callback statut appel ─────────────────────────────────────────────────────
router.post('/call-status', (req, res) => {
  const { CallSid, CallStatus, To, Duration } = req.body;
  console.info(`[twilio] appel ${CallSid} → ${To} : ${CallStatus}${Duration ? ` (${Duration}s)` : ''}`);
  res.sendStatus(204);
});

// ── TwiML : routage des appels Voice SDK (in-app) ─────────────────────────────
// L'app appelante (driver/client/CC) fait .connect({ params: { To: '...' } }).
// To = identité SDK ('driver_123', 'client_456', 'cc'), 'delivery_<id>' (CC → client
// sans app, résolu en numéro PSTN via la livraison), ou numéro de téléphone (+222...).
const SDK_IDENTITY = /^(driver|client)_[\w-]+$|^cc$/;

router.post('/voice-sdk', async (req, res) => {
  if (env.NODE_ENV === 'production' && env.TWILIO_AUTH_TOKEN) {
    const valid = twilio.validateRequest(
      env.TWILIO_AUTH_TOKEN,
      req.headers['x-twilio-signature'] || '',
      `${env.PUBLIC_URL}/webhooks/twilio/voice-sdk`,
      req.body,
    );
    if (!valid) return res.status(403).send('Invalid signature');
  }

  const to = (req.body.To || '').trim();
  const twiml = new twilio.twiml.VoiceResponse();

  if (!to) {
    twiml.say({ language: 'fr-FR' }, "Destinataire manquant.");
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // CC → client via deliveryId : résoudre le numéro de téléphone du client (PSTN)
  const deliveryMatch = to.match(/^delivery_(.+)$/);
  if (deliveryMatch) {
    try {
      const delivery = await db('deliveries').where({ id: deliveryMatch[1] }).first('client_id');
      const client = delivery && await db('clients').where({ id: delivery.client_id }).first('wa_id_enc');
      let clientPhone = client?.wa_id_enc && decryptWaId(client.wa_id_enc);
      if (clientPhone && !clientPhone.startsWith('+')) clientPhone = `+${clientPhone}`;
      if (!clientPhone) {
        twiml.say({ language: 'fr-FR' }, "Numéro client introuvable.");
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      twiml.dial({ callerId: env.TWILIO_PHONE_NUMBER }).number(clientPhone);
      res.type('text/xml');
      return res.send(twiml.toString());
    } catch (err) {
      console.error('[twilio] voice-sdk delivery lookup:', err.message);
      twiml.say({ language: 'fr-FR' }, "Erreur lors de la résolution du numéro.");
      res.type('text/xml');
      return res.send(twiml.toString());
    }
  }

  const dial = twiml.dial({ callerId: env.TWILIO_PHONE_NUMBER });
  if (SDK_IDENTITY.test(to)) {
    dial.client(to);
  } else {
    dial.number(to);
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

export default router;
