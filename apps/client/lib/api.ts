const BASE = process.env.EXPO_PUBLIC_API_URL!;
const WA_PHONE_ID = process.env.EXPO_PUBLIC_WA_PHONE_ID!;

export type Message = {
  id: string;
  sender_role: 'client' | 'driver';
  type: 'text' | 'location' | 'audio' | 'image';
  content: string | null;
  meta: Record<string, any> | null;
  createdAt: string;
};

export type Delivery = {
  id: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'done' | 'cancelled';
  description: string | null;
};

export type ConversationResponse = {
  client: { id: string; alias: string } | null;
  delivery: Delivery | null;
  messages: Message[];
};

function buildPayload(type: string, phone: string, body: any) {
  const msg: any = {
    id: `wamid.sim_${Date.now()}`,
    from: phone.replace(/[^\d]/g, ''),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type,
  };
  if (type === 'text') msg.text = { body };
  if (type === 'location') msg.location = body;
  if (type === 'audio') msg.audio = body;
  if (type === 'image') msg.image = body;

  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'sim_entry', changes: [{ value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: WA_PHONE_ID },
      messages: [msg],
    }}]}],
  };
}

export async function sendWhatsAppMessage(phone: string, type: string, body: any) {
  const payload = buildPayload(type, phone, body);
  const res = await fetch(`${BASE}/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
}

export async function getConversation(phone: string): Promise<ConversationResponse> {
  const res = await fetch(`${BASE}/sim/conversation?phone=${encodeURIComponent(phone)}`);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

export async function uploadFile(uri: string, mime: string, ext: string): Promise<{ url: string; key: string }> {
  const formData = new FormData();
  formData.append('file', { uri, type: mime, name: `file.${ext}` } as any);
  // Upload sans auth — endpoint public en dev
  const res = await fetch(`${BASE}/api/upload-public`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload échoué ${res.status}`);
  return res.json();
}
