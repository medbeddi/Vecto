import { create } from 'zustand';
import { api } from '../lib/api';
import type { Delivery, Message } from '../types';

type DeliveriesState = {
  available: Delivery[];
  activeDelivery: Delivery | null;
  messages: Message[];
  loadingDeliveries: boolean;
  loadingMessages: boolean;

  loadAvailable: () => Promise<void>;
  upsertAvailable: (d: Delivery) => void;
  removeAvailable: (id: string) => void;

  setActiveDelivery: (d: Delivery | null) => void;
  updateActiveStatus: (status: Delivery['status']) => void;

  loadMessages: (deliveryId: string) => Promise<void>;
  appendMessage: (m: Message) => void;
};

export const useDeliveriesStore = create<DeliveriesState>((set) => ({
  available: [],
  activeDelivery: null,
  messages: [],
  loadingDeliveries: false,
  loadingMessages: false,

  loadAvailable: async () => {
    set({ loadingDeliveries: true });
    try {
      const { deliveries } = await api<{ deliveries: Delivery[] }>(
        '/api/deliveries/available'
      );
      set({ available: deliveries, loadingDeliveries: false });
    } catch {
      set({ loadingDeliveries: false });
    }
  },

  upsertAvailable: (d) =>
    set((s) => {
      const exists = s.available.some((x) => x.id === d.id);
      return { available: exists ? s.available : [d, ...s.available] };
    }),

  removeAvailable: (id) =>
    set((s) => ({ available: s.available.filter((d) => d.id !== id) })),

  setActiveDelivery: (d) => set({ activeDelivery: d, messages: [] }),

  updateActiveStatus: (status) =>
    set((s) =>
      s.activeDelivery ? { activeDelivery: { ...s.activeDelivery, status } } : {}
    ),

  loadMessages: async (deliveryId) => {
    set({ loadingMessages: true });
    try {
      const { messages } = await api<{ messages: Message[] }>(
        `/api/deliveries/${deliveryId}/messages`
      );
      set({ messages, loadingMessages: false });
    } catch {
      set({ loadingMessages: false });
    }
  },

  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
}));
