import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { env } from '../config/env.js';

const __dirnameMedia = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_UPLOADS_DIR = path.join(__dirnameMedia, '../../uploads');
mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

const r2 = env.R2_ENABLED
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const META_TIMEOUT = 20_000; // 20s max par appel Meta

// Télécharge un media depuis Meta Cloud API et retourne le buffer + mimeType
export async function downloadFromMeta(mediaId) {
  // Étape 1 : obtenir l'URL de téléchargement
  const { data: meta } = await axios.get(
    `https://graph.facebook.com/v22.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${env.WA_TOKEN}` }, timeout: META_TIMEOUT }
  );

  // Étape 2 : télécharger le binaire
  const { data, headers } = await axios.get(meta.url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${env.WA_TOKEN}` },
    timeout: META_TIMEOUT,
  });

  return {
    buffer: Buffer.from(data),
    mimeType: headers['content-type'] || 'application/octet-stream',
  };
}

// Upload vers R2 avec 1 retry automatique
export async function uploadToR2WithRetry(buffer, key, contentType) {
  try {
    return await uploadToR2(buffer, key, contentType);
  } catch (err) {
    // 1 retry après 1.5s
    await new Promise((r) => setTimeout(r, 1500));
    return await uploadToR2(buffer, key, contentType);
  }
}

// Upload vers R2 et retourne la clé de stockage
export async function uploadToR2(buffer, key, contentType) {
  if (!r2) throw Object.assign(new Error('R2 non configuré'), { code: 'R2_NOT_CONFIGURED' });
  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

// Génère toujours une URL signée (fonctionne bucket public ET privé)
export async function getSignedMediaUrl(key, expiresIn = 3600) {
  if (!r2) throw Object.assign(new Error('R2 non configuré'), { code: 'R2_NOT_CONFIGURED' });
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn }
  );
}

// Génère une URL pré-signée pour upload direct Flutter → R2 (PUT)
export async function getSignedUploadUrl(key, expiresIn = 300) {
  if (!r2) throw Object.assign(new Error('R2 non configuré'), { code: 'R2_NOT_CONFIGURED' });
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn }
  );
}

// Sauvegarde locale quand R2 est indisponible — fallback disk
// Retourne le filename plat (slashes remplacés par _)
export function saveToLocalDisk(buffer, key) {
  const filename = key.replace(/\//g, '_');
  writeFileSync(path.join(LOCAL_UPLOADS_DIR, filename), buffer);
  return filename;
}

// Dérive l'extension depuis le Content-Type
export function extFromMime(mimeType) {
  const map = {
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const base = mimeType.split(';')[0].trim();
  return map[base] || 'bin';
}
