import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.EXPO_PUBLIC_API_URL!;

let socket: Socket | null = null;

export function connectClientSocket(token: string) {
  if (socket) return socket; // socket.io gère sa propre reconnexion
  socket = io(API_BASE, {
    auth: { token },
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
  return socket;
}

export function getClientSocket() {
  return socket;
}

export function disconnectClientSocket() {
  socket?.disconnect();
  socket = null;
}
