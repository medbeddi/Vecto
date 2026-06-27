import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env.js';
import { getSignedMediaUrl } from './media.js';

const WA_API       = `https://graph.facebook.com/v22.0/${env.WA_PHONE_ID}/messages`;
const WA_MEDIA_API = `https://graph.facebook.com/v22.0/${env.WA_PHONE_ID}/media`;

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

const MIME_MAP = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  mp3: 'audio/mpeg', mpeg: 'audio/mpeg',
  ogg: 'audio/ogg', oga: 'audio/ogg',
  amr: 'audio/amr', webm: 'audio/ogg',
};

function mimeFromUrl(url) {
  const ext = (url?.split('?')[0].split('.').pop() ?? '').toLowerCase();
  return MIME_MAP[ext] ?? 'audio/mp4';
}

// Upload audio to WhatsApp media endpoint and return media_id.
// Using media_id (instead of link) makes the audio display as a PTT voice note.
async function uploadAudioToWhatsApp(url, mimeHint) {
  console.info('[messaging] téléchargement audio depuis:', url.slice(0, 120));
  const dlRes = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(dlRes.data);

  const mime = mimeHint || dlRes.headers['content-type'] || mimeFromUrl(url);
  const ext  = Object.entries(MIME_MAP).find(([, v]) => v === mime)?.[0] ?? 'm4a';
  console.info('[messaging] audio téléchargé: mime=%s taille=%d octets', mime, buffer.byteLength);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', buffer, { filename: `voice.${ext}`, contentType: mime });

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
  // Détecter le MIME depuis l'extension avant résolution (la clé R2 a l'extension)
  const mimeHint = mimeFromUrl(urlOrKey);

  // Résoudre en URL signée 7 jours (fonctionne bucket public ET privé)
  let url = urlOrKey;
  if (!urlOrKey?.startsWith('http')) {
    url = await getSignedMediaUrl(urlOrKey, 604800);
  } else if (env.R2_PUBLIC_URL && urlOrKey.startsWith(env.R2_PUBLIC_URL + '/')) {
    const key = urlOrKey.slice(env.R2_PUBLIC_URL.length + 1);
    try { url = await getSignedMediaUrl(key, 604800); } catch {}
  }
  const fallbackUrl = url;

  // Try media upload first (shows as PTT voice note in WhatsApp)
  try {
    const mediaId = await uploadAudioToWhatsApp(url, mimeHint);
    return post({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'audio',
      audio: { id: mediaId },
    });
  } catch (uploadErr) {
    const detail = uploadErr.response?.data ?? uploadErr.message;
    console.error('[messaging] media upload failed → fallback link. raison:', JSON.stringify(detail));
    console.info('[messaging] fallback link URL:', fallbackUrl.slice(0, 120));
    return post({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'audio',
      audio: { link: fallbackUrl },
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
