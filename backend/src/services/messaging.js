import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env.js';
import { getSignedMediaUrl } from './media.js';

const WA_API       = `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`;
const WA_MEDIA_API = `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/media`;

async function post(payload) {
  try {
    const { data } = await axios.post(WA_API, payload, {
      headers: {
        Authorization: `Bearer ${env.WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    return data;
  } catch (err) {
    const detail = err.response?.data;
    console.error('[messaging] WhatsApp API erreur:', JSON.stringify(detail));
    throw err;
  }
}

// Upload audio to WhatsApp media endpoint and return media_id.
// Using media_id (instead of link) makes the audio display as a PTT voice note.
async function uploadAudioToWhatsApp(url) {
  console.info('[messaging] téléchargement audio depuis:', url.slice(0, 120));
  const dlRes = await axios.get(url, { responseType: 'arraybuffer' });
  const contentType = dlRes.headers['content-type'] || '';
  console.info('[messaging] audio téléchargé: Content-Type=%s taille=%d octets', contentType, dlRes.data.byteLength);

  if (!contentType.includes('ogg') && !contentType.includes('opus')) {
    throw Object.assign(
      new Error(`Format non supporté par WhatsApp PTT: ${contentType}`),
      { code: 'UNSUPPORTED_FORMAT' }
    );
  }

  const buffer = Buffer.from(dlRes.data);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg; codecs=opus');
  form.append('file', buffer, { filename: 'voice.ogg', contentType: 'audio/ogg; codecs=opus' });

  const { data } = await axios.post(WA_MEDIA_API, form, {
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, ...form.getHeaders() },
  });
  console.info('[messaging] WhatsApp media upload OK, id=%s', data.id);
  return data.id;
}

// waId = numéro décrypté (jamais loggé, jamais exposé à l'extérieur de ce service)

export async function sendText(waId, text) {
  return post({
    messaging_product: 'whatsapp',
    to: waId,
    type: 'text',
    text: { body: text },
  });
}

export async function sendAudio(waId, urlOrKey) {
  const url = urlOrKey?.startsWith('http') ? urlOrKey : await getSignedMediaUrl(urlOrKey, 300);

  // Try media upload first (shows as PTT voice note in WhatsApp)
  try {
    const mediaId = await uploadAudioToWhatsApp(url);
    return post({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'audio',
      audio: { id: mediaId, voice: true },
    });
  } catch (uploadErr) {
    const detail = uploadErr.response?.data ?? uploadErr.message;
    console.error('[messaging] media upload failed → fallback link. raison:', JSON.stringify(detail));
    console.info('[messaging] fallback link URL:', url.slice(0, 120));
    return post({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'audio',
      audio: { link: url },
    });
  }
}

export async function sendImage(waId, urlOrKey, caption = '') {
  const url = urlOrKey?.startsWith('http') ? urlOrKey : await getSignedMediaUrl(urlOrKey, 300);
  return post({
    messaging_product: 'whatsapp',
    to: waId,
    type: 'image',
    image: { link: url, caption },
  });
}

export async function sendLocation(waId, lat, lng, name = '') {
  return post({
    messaging_product: 'whatsapp',
    to: waId,
    type: 'location',
    location: { latitude: lat, longitude: lng, name },
  });
}
