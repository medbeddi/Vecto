export type Driver = {
  id: string;
  name: string;
};

export type Delivery = {
  id: string;
  description: string | null;
  clientAlias: string;
  createdAt: string;
  broadcastAt?: string | null;
  status?: 'pending' | 'assigned' | 'in_progress' | 'done' | 'cancelled';
  initialMediaType?: string | null;
  initialMediaUrl?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  price?: number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
};

export type MessageType = 'text' | 'audio' | 'image' | 'location';
export type SenderRole = 'client' | 'driver';

export type MessageMeta = {
  lat?: number;
  lng?: number;
  label?: string;
  r2Key?: string;
  duration?: number | null;
};

export type Message = {
  id: string;
  senderRole: SenderRole;
  type: MessageType;
  content: string | null;
  meta: MessageMeta | null;
  createdAt: string;
};

export type CCMessage = {
  id: string;
  senderRole: 'admin' | 'driver';
  type: string;
  content: string;
  createdAt: string;
};

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  OTP: { phone: string; mode?: 'register' | 'reset' };
  Setup: { phone: string; code: string };
  ResetPassword: { phone: string; code: string };
  Main: undefined;
  Chat: { delivery: Delivery };
};
