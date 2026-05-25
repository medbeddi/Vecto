import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.EXPO_PUBLIC_API_URL!;

let socket: Socket | null = null;

export function connectClientSocket(token: string) {
  if (socket?.connected) return socket;
  socket = io(API_BASE, {
    auth: { token },
    transports: ['polling', 'websocket'],
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
