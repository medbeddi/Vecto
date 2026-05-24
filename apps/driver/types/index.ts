export type Driver = {
  id: string;
  name: string;
};

export type Delivery = {
  id: string;
  description: string | null;
  clientAlias: string;
  createdAt: string;
  status?: 'pending' | 'assigned' | 'in_progress' | 'done' | 'cancelled';
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

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Deliveries: undefined;
  Chat: { delivery: Delivery };
};
