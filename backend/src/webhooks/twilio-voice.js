import { Router } from 'express';
import twilio from 'twilio';
import { env } from '../config/env.js';

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

export default router;
