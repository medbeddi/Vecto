import axios from 'axios';
import FormData from 'form-data';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { env } from '../config/env.js';
import { getSignedMediaUrl } from './media.js';

const execFileAsync = promisify(execFile);

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
  amr: 'audio/amr', webm: 'audio/webm',
};

function mimeFromUrl(url) {
  const ext = (url?.split('?')[0].split('.').pop() ?? '').toLowerCase();
  return MIME_MAP[ext] ?? 'audio/mp4';
}

// Convertit n'importe quel buffer audio en OGG Opus via ffmpeg.
// ffmpeg auto-détecte le format d'entrée (WebM, M4A, etc.)
async function toOggOpus(buffer, inputExt) {
  const id      = randomBytes(8).toString('hex');
  const inFile  = join(tmpdir(), `wa_${id}.${inputExt}`);
  const outFile = join(tmpdir(), `wa_${id}.ogg`);
  try {
    await writeFile(inFile, buffer);
    await execFileAsync(ffmpegPath, [
      '-y', '-i', inFile,
      '-c:a', 'libopus', '-b:a', '32k',
      '-vbr', 'on', '-compression_level', '10',
      outFile,
    ]);
    const result = await readFile(outFile);
    // Vérifier les magic bytes OGG (OggS = 4f676753)
    const magic = result.slice(0, 4).toString('hex');
    if (magic !== '4f676753') throw new Error(`OGG invalide (magic=${magic})`);
    console.info('[messaging] %s→OGG OK (%d → %d octets)', inputExt.toUpperCase(), buffer.byteLength, result.byteLength);
    return result;
  } finally {
    await Promise.all([unlink(inFile).catch(() => {}), unlink(outFile).catch(() => {})]);
  }
}

// Upload audio to WhatsApp media endpoint and return media_id.
// Using media_id (instead of link) + OGG Opus format = PTT voice note on WhatsApp (format bas).
async function uploadAudioToWhatsApp(url, mimeHint) {
  console.info('[messaging] téléchargement audio depuis:', url.slice(0, 120));
  const dlRes = await axios.get(url, { responseType: 'arraybuffer' });
  let buffer = Buffer.from(dlRes.data);

  let mime = mimeHint || dlRes.headers['content-type'] || mimeFromUrl(url);

  // Convertir WebM ou M4A en OGG Opus pour PTT WhatsApp
  if (mime === 'audio/webm') {
    try {
      buffer = await toOggOpus(buffer, 'webm');
      mime = 'audio/ogg';
    } catch (convErr) {
      console.error('[messaging] WebM→OGG échouée:', convErr.message);
    }
  } else if (mime === 'audio/mp4') {
    try {
      buffer = await toOggOpus(buffer, 'm4a');
      mime = 'audio/ogg';
    } catch (convErr) {
      console.warn('[messaging] M4A→OGG échouée → envoi M4A direct (audio normal, pas PTT):', convErr.message);
      // garde mime = 'audio/mp4' → arrive comme audio normal mais arrive quand même
    }
  }

  const ext = Object.entries(MIME_MAP).find(([, v]) => v === mime)?.[0] ?? 'm4a';
  // WhatsApp exige audio/ogg; codecs=opus pour les vocaux PTT OGG Opus
  const uploadMime = mime === 'audio/ogg' ? 'audio/ogg; codecs=opus' : mime;
  console.info('[messaging] audio prêt: mime=%s taille=%d octets', uploadMime, buffer.byteLength);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', uploadMime);
  form.append('file', buffer, { filename: `voice.${ext}`, contentType: uploadMime });

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

  // Try media upload first → OGG Opus → vocal PTT sur WhatsApp (format bas)
  try {
    const mediaId = await uploadAudioToWhatsApp(url, mimeHint);
    const result = await post({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'audio',
      audio: { id: mediaId },
    });
    console.info('[messaging] audio PTT envoyé OK, wamid=%s', result?.messages?.[0]?.id);
    return result;
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
