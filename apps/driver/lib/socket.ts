import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './config';
import { storage } from './storage';
import type { Delivery, Message } from '../types';

type EventMap = {
  new_delivery: (data: Delivery) => void;
  client_message: (data: Message) => void;
  delivery_cancelled: (data: { deliveryId: string }) => void;
  relay_error: (data: { deliveryId: string; code: string }) => void;
};

class SocketService {
  private _socket: Socket | null = null;

  async connect(): Promise<void> {
    if (this._socket?.connected) return;

    const token = await storage.getAccessToken();
    if (!token) throw new Error('AUTH_REQUIRED');

    this._socket = io(API_BASE, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    this._socket.on('connect', () =>
      console.info('[socket] connecté sid=' + this._socket?.id)
    );
    this._socket.on('connect_error', (err) =>
      console.warn('[socket] erreur:', err.message)
    );
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
