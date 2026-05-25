const BASE = process.env.EXPO_PUBLIC_API_URL!;

let _token: string | null = null;
export function setClientToken(t: string) { _token = t; }
export function getClientToken() { return _token; }

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'ERROR'), { code: data.error });
  return data as T;
}

// ── OTP ───────────────────────────────────────────────────────────────────────

export async function sendOtp(phone: string) {
  await req('/api/otp/send', { method: 'POST', body: JSON.stringify({ phone }) });
}

export async function verifyOtpClient(phone: string, code: string) {
  return req<{ token: string; client: { id: string; alias: string } }>(
    '/api/otp/verify/client',
    { method: 'POST', body: JSON.stringify({ phone, code }) }
  );
}

// ── Delivery ──────────────────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'cancelled';

export type Message = {
  id: string;
  senderRole: 'client' | 'driver';
  type: 'text' | 'audio' | 'image' | 'location';
  content: string | null;
  meta: Record<string, any> | null;
  createdAt: string;
};

export type Delivery = { id: string; status: DeliveryStatus };

export async function getActiveDelivery(): Promise<{ delivery: Delivery | null; messages: Message[] }> {
  return req('/api/client/delivery/active');
}

export async function createDelivery(payload: {
  type: string;
  content?: string | null;
  meta?: Record<string, any> | null;
}): Promise<{ delivery: Delivery }> {
  return req('/api/client/delivery', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getMessages(deliveryId: string): Promise<{ messages: Message[] }> {
  return req(`/api/client/delivery/${deliveryId}/messages`);
}

export async function sendMessage(deliveryId: string, payload: {
  type: string;
  content?: string | null;
  meta?: Record<string, any> | null;
}): Promise<{ message: Message }> {
  return req(`/api/client/delivery/${deliveryId}/message`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadFile(uri: string, mime: string, ext: string): Promise<{ url: string; key: string }> {
  const formData = new FormData();
  formData.append('file', { uri, type: mime, name: `file.${ext}` } as any);
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${_token}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload échoué ${res.status}`);
  return res.json();
}
