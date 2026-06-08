import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './config';
import { storage } from './storage';
import type { Delivery, Message } from '../types';

async function getFreshToken(): Promise<string | null> {
  try {
    const token = await storage.getAccessToken();
    if (!token) return null;
    // Vérifie expiry sans lib externe — le payload JWT est en base64
    const [, payload] = token.split('.');
    const { exp } = JSON.parse(atob(payload));
    if (exp * 1000 > Date.now() + 60_000) return token; // valide > 1 min
    // Token bientôt expiré — refresh
    const rt = await storage.getRefreshToken();
    if (!rt) return null;
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return null;
    const { accessToken } = await res.json();
    await storage.setTokens(accessToken, rt);
    return accessToken;
  } catch {
    return null;
  }
}

type NewOrderPayload = {
  deliveryId: string;
  clientAlias: string;
  createdAt: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  price?: number | null;
  message: { type: string; content: string | null; meta: any };
};

type EventMap = {
  new_order: (data: NewOrderPayload) => void;
  order_taken: (data: { deliveryId: string }) => void;
  client_message: (data: Message) => void;
  delivery_cancelled: (data: { deliveryId: string }) => void;
  relay_error: (data: { deliveryId: string; code: string }) => void;
  cc_message: (data: { id: string; senderRole: string; content: string; createdAt: string }) => void;
};

class SocketService {
  private _socket: Socket | null = null;

  async connect(): Promise<void> {
    if (this._socket?.connected) return;

    const token = await getFreshToken();
    if (!token) throw new Error('AUTH_REQUIRED');

    this._socket = io(API_BASE, {
      auth: { token: `Bearer ${token}` },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });

    this._socket.on('connect', () =>
      console.info('[socket] connecté sid=' + this._socket?.id)
    );

    // Si le token expire pendant la session, refresh et reconnecte
    this._socket.on('connect_error', async (err) => {
      console.warn('[socket] erreur:', err.message);
      if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
        this._socket?.disconnect();
        this._socket = null;
        try { await this.connect(); } catch {}
      }
    });
  }

  disconnect() {
    this._socket?.disconnect();
    this._socket = null;
  }

  joinRoom(deliveryId: string) {
    this._socket?.emit('join_room', { deliveryId });
  }

  sendMessage(
    deliveryId: string,
    type: string,
    content: string | null,
    meta?: object
  ) {
    this._socket?.emit('driver_message', { deliveryId, type, content, meta });
  }

  sendLocation(lat: number, lng: number) {
    this._socket?.emit('driver_location', { lat, lng });
  }

  on<K extends keyof EventMap>(event: K, handler: EventMap[K]) {
    this._socket?.on(event as string, handler as never);
  }

  off<K extends keyof EventMap>(event: K, handler: EventMap[K]) {
    this._socket?.off(event as string, handler as never);
  }

  get connected() {
    return this._socket?.connected ?? false;
  }
}

export const socketService = new SocketService();
