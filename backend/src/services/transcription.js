import { env } from '../config/env.js';

const OFFENSIVE_WORDS = ['أمك', 'أبوك', 'نمشط', 'تينة', 'زب'];

/**
 * Transcrit un buffer audio via Whisper et analyse le contenu.
 * @returns {{ text: string, isEmpty: boolean, isOffensive: boolean }}
 */
export async function transcribeAndAnalyze(buffer, mimeType) {
  if (!env.OPENAI_API_KEY) {
    console.warn('[transcription] OPENAI_API_KEY non configuré — audio transmis à l\'admin sans analyse');
    return { text: '', isEmpty: false, isOffensive: false };
  }

  if (!buffer || buffer.length === 0) {
    console.warn('[transcription] buffer audio null/vide — audio transmis à l\'admin sans analyse');
    return { text: '', isEmpty: false, isOffensive: false };
  }

  try {
    const ext = mimeType?.split('/')[1]?.split(';')[0] || 'ogg';
    console.info(`[transcription] envoi Whisper buffer=${buffer.length}b mimeType=${mimeType}`);
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'ar');
    formData.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[transcription] Whisper erreur:', err?.error?.message ?? res.status);
      return { text: '', isEmpty: false, isOffensive: false };
    }

    const data = await res.json();
    const text = (data.text ?? '').trim();
    const isEmpty = text.length === 0;
    const isOffensive = !isEmpty && OFFENSIVE_WORDS.some((w) => text.includes(w));

    console.info(`[transcription] texte="${text.slice(0, 80)}" isEmpty=${isEmpty} isOffensive=${isOffensive}`);
    return { text, isEmpty, isOffensive };
  } catch (err) {
    console.error('[transcription] erreur réseau:', err.message);
    return { text: '', isEmpty: false, isOffensive: false };
  }
}

export function containsOffensiveWords(text) {
  if (!text) return false;
  return OFFENSIVE_WORDS.some((w) => text.includes(w));
}
