import twilio from 'twilio';
import { env } from '../config/env.js';

let _client = null;

function getClient() {
  if (!_client) {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN manquants)');
    }
    _client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

export const twilioEnabled = () =>
  !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);

export const twilioVerifyEnabled = () =>
  twilioEnabled() && !!env.TWILIO_VERIFY_SID;

export const voiceSdkEnabled = () =>
  twilioEnabled() && !!(env.TWILIO_TWIML_APP_SID && env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET);

// ── Voice SDK — token d'accès pour appels in-app (driver/client/CC) ──────────

export function generateVoiceAccessToken(identity) {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_API_KEY_SID,
    env.TWILIO_API_KEY_SECRET,
    { identity, ttl: 3600 }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);

  return token.toJwt();
}

// ── OTP via Twilio Verify ─────────────────────────────────────────────────────

export async function sendOtpViaTwilio(phone) {
  await getClient().verify.v2
    .services(env.TWILIO_VERIFY_SID)
    .verifications
    .create({ to: phone, channel: 'sms' });
}

export async function checkOtpViaTwilio(phone, code) {
  const check = await getClient().verify.v2
    .services(env.TWILIO_VERIFY_SID)
    .verificationChecks
    .create({ to: phone, code });
  return check.status === 'approved';
}

// ── SMS ───────────────────────────────────────────────────────────────────────

export async function sendSms(to, body) {
  const phone = to.startsWith('+') ? to : '+' + to;
  return getClient().messages.create({ to: phone, from: env.TWILIO_PHONE_NUMBER, body });
}

// ── Appels vocaux — conférence bridgée ────────────────────────────────────────
// Twilio appelle les deux partis séparément et les met dans la même conférence.

export async function initiateConferenceCall({ callerPhone, calleePhone, conferenceId }) {
  const client = getClient();
  const base = env.PUBLIC_URL || '';
  const twimlUrl = `${base}/webhooks/twilio/voice?conf=${encodeURIComponent(conferenceId)}`;
  const statusUrl = `${base}/webhooks/twilio/call-status`;

  const [callerCall, calleeCall] = await Promise.all([
    client.calls.create({
      to: callerPhone,
      from: env.TWILIO_PHONE_NUMBER,
      url: twimlUrl,
      statusCallback: statusUrl,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST',
    }),
    client.calls.create({
      to: calleePhone,
      from: env.TWILIO_PHONE_NUMBER,
      url: twimlUrl,
      statusCallback: statusUrl,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST',
    }),
  ]);

  return { callerSid: callerCall.sid, calleeSid: calleeCall.sid };
}
