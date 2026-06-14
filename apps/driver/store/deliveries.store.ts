import { create } from 'zustand';
import { api } from '../lib/api';
import type { Delivery, Message } from '../types';

type DeliveriesState = {
  available: Delivery[];
  activeCourses: Delivery[];
  activeDelivery: Delivery | null;
  messages: Message[];
  loadingDeliveries: boolean;
  loadingMessages: boolean;

  loadAvailable: () => Promise<void>;
  loadActiveCourses: () => Promise<void>;
  upsertAvailable: (d: Delivery) => void;
  removeAvailable: (id: string) => void;

  addActiveCourse: (d: Delivery) => void;
  removeActiveCourse: (id: string) => void;

  setActiveDelivery: (d: Delivery | null) => void;
  updateActiveStatus: (status: Delivery['status']) => void;

  loadMessages: (deliveryId: string) => Promise<void>;
  appendMessage: (m: Message) => void;

  pendingCancellation: { deliveryId: string; clientAlias: string } | null;
  setPendingCancellation: (c: { deliveryId: string; clientAlias: string } | null) => void;
};

export const useDeliveriesStore = create<DeliveriesState>((set) => ({
  available: [],
  activeCourses: [],
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

  loadActiveCourses: async () => {
    try {
      const { deliveries } = await api<{ deliveries: Delivery[] }>('/api/deliveries/mine');
      set({ activeCourses: deliveries });
    } catch {}
  },

  upsertAvailable: (d) =>
    set((s) => {
      const exists = s.available.some((x) => x.id === d.id);
      if (exists) {
        // Mettre à jour broadcastAt + données si la course est déjà en liste (re-broadcast)
        return { available: s.available.map((x) => x.id === d.id ? { ...x, ...d } : x) };
      }
      return { available: [d, ...s.available] };
    }),

  removeAvailable: (id) =>
    set((s) => ({ available: s.available.filter((d) => d.id !== id) })),

  addActiveCourse: (d) =>
    set((s) => {
      const exists = s.activeCourses.some((x) => x.id === d.id);
      return { activeCourses: exists ? s.activeCourses.map((x) => x.id === d.id ? d : x) : [d, ...s.activeCourses] };
    }),

  removeActiveCourse: (id) =>
    set((s) => ({ activeCourses: s.activeCourses.filter((d) => d.id !== id) })),

  setActiveDelivery: (d) => set({ activeDelivery: d, messages: [] }),

  updateActiveStatus: (status) =>
    set((s) => {
      if (!s.activeDelivery) return {};
      const updated = { ...s.activeDelivery, status };
      return {
        activeDelivery: updated,
        activeCourses: s.activeCourses.map((d) => d.id === updated.id ? updated : d),
      };
    }),

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

  appendMessage: (m) =>
    set((s) =>
      s.messages.some((msg) => msg.id === m.id)
        ? s
        : { messages: [...s.messages, m] }
    ),

  pendingCancellation: null,
  setPendingCancellation: (c) => set({ pendingCancellation: c }),
}));
