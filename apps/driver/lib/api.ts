import { API_BASE } from './config';
import { storage } from './storage';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number
  ) {
    super(code);
  }
}

// File à drain lors d'un refresh en cours
let refreshing = false;
let queue: Array<(token: string) => void> = [];

async function doRefresh(): Promise<string> {
  const rt = await storage.getRefreshToken();
  if (!rt) throw new ApiError('SESSION_EXPIRED', 401);

  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });
  const body = await res.json();
  if (!res.ok) throw new ApiError(body.error ?? 'REFRESH_FAILED', 401);

  await storage.setTokens(body.accessToken, rt);
  return body.accessToken as string;
}

type Opts = {
  method?: string;
  body?: unknown;
  token?: string | null;
  _retry?: boolean;
};

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const token = opts.token !== undefined
    ? opts.token
    : await storage.getAccessToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Auto-refresh transparent sur 401
  if (res.status === 401 && !opts._retry) {
    if (!refreshing) {
      refreshing = true;
      try {
        const newToken = await doRefresh();
        queue.forEach((cb) => cb(newToken));
        queue = [];
        return api<T>(path, { ...opts, token: newToken, _retry: true });
      } catch (err) {
        queue = [];
        throw err;
      } finally {
        refreshing = false;
      }
    }
    // D'autres requêtes attendent le token rafraîchi
    return new Promise((resolve, reject) => {
      queue.push(async (newToken: string) => {
        try {
          resolve(await api<T>(path, { ...opts, token: newToken, _retry: true }));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? res.statusText, res.status);
  return data as T;
}

// Upload fichier avec auth + auto-refresh du token
export async function uploadFile(
  path: string,
  formData: FormData,
  _retry = false
): Promise<{ url: string; key: string }> {
  const token = await storage.getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (res.status === 401 && !_retry) {
    if (!refreshing) {
      refreshing = true;
      try {
        const newToken = await doRefresh();
        queue.forEach((cb) => cb(newToken));
        queue = [];
        return uploadFile(path, formData, true);
      } catch (err) {
        queue = [];
        throw err;
      } finally {
        refreshing = false;
      }
    }
    return new Promise((resolve, reject) => {
      queue.push(async (newToken: string) => {
        try { resolve(await uploadFile(path, formData, true)); }
        catch (e) { reject(e); }
      });
    });
  }
  if (!res.ok) {
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    throw new ApiError(data?.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<{ url: string; key: string }>;
}

const ALLOWED_R2_HOSTS = ['r2.cloudflarestorage.com', 'pub-', 'railway.app'];

// Upload direct vers R2 via URL pré-signée (PUT)
export async function uploadToR2(
  presignedUrl: string,
  fileUri: string,
  mimeType: string
): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(presignedUrl);
  } catch {
    throw new ApiError('INVALID_UPLOAD_URL', 400);
  }
  if (parsedUrl.protocol !== 'https:') throw new ApiError('INVALID_UPLOAD_URL', 400);
  const hostOk = ALLOWED_R2_HOSTS.some((h) => parsedUrl.hostname.includes(h));
  if (!hostOk) throw new ApiError('INVALID_UPLOAD_URL', 400);
  if (!fileUri.startsWith('file://') && !fileUri.startsWith('content://')) {
    throw new ApiError('INVALID_FILE_URI', 400);
  }
  const blob = await fetch(fileUri).then((r) => r.blob());
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': mimeType },
  });
  if (!res.ok) throw new ApiError(`UPLOAD_FAILED_${res.status}`, res.status);
}
