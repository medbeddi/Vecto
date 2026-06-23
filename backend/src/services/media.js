import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { env } from '../config/env.js';

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

// Télécharge un media depuis Meta Cloud API et retourne le buffer + mimeType
export async function downloadFromMeta(mediaId) {
  // Étape 1 : obtenir l'URL de téléchargement
  const { data: meta } = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${env.WA_TOKEN}` } }
  );

  // Étape 2 : télécharger le binaire
  const { data, headers } = await axios.get(meta.url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${env.WA_TOKEN}` },
  });

  return {
    buffer: Buffer.from(data),
    mimeType: headers['content-type'] || 'application/octet-stream',
  };
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

// Génère une URL publique (si R2_PUBLIC_URL configuré) ou signée (expire dans `expiresIn` secondes)
export async function getSignedMediaUrl(key, expiresIn = 3600) {
  if (!r2) throw Object.assign(new Error('R2 non configuré'), { code: 'R2_NOT_CONFIGURED' });
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL}/${key}`;
  }
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
