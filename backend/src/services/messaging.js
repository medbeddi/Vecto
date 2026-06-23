import axios from 'axios';
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
  const { data: fileData } = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(fileData);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg');
  form.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');

  const { data } = await axios.post(WA_MEDIA_API, form, {
    headers: { Authorization: `Bearer ${env.WA_TOKEN}` },
  });
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
      audio: { id: mediaId },
    });
  } catch (uploadErr) {
    console.error('[messaging] media upload failed, fallback to link:', uploadErr.response?.data ?? uploadErr.message);
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
