import axios from 'axios';
import { env } from '../config/env.js';
import { getSignedMediaUrl } from './media.js';

const WA_API = `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`;

async function post(payload) {
  const { data } = await axios.post(WA_API, payload, {
    headers: {
      Authorization: `Bearer ${env.WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  return data;
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

export async function sendAudio(waId, r2Key) {
  const url = await getSignedMediaUrl(r2Key, 300);
  return post({
    messaging_product: 'whatsapp',
    to: waId,
    type: 'audio',
    audio: { link: url },
  });
}

export async function sendImage(waId, r2Key, caption = '') {
  const url = await getSignedMediaUrl(r2Key, 300);
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
