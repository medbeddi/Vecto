import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { storage } from '../lib/storage';
import { socketService } from '../lib/socket';
import type { Driver } from '../types';

type AuthState = {
  driver: Driver | null;
  isReady: boolean;   // true quand l'init async est terminée
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  driver: null,
  isReady: false,
  isLoading: false,
  error: null,

  initialize: async () => {
    try {
      const [token, driver] = await Promise.all([
        storage.getAccessToken(),
        storage.getDriver(),
      ]);
      if (token && driver) {
        set({ driver, isReady: true });
        socketService.connect().catch(() => {});
      } else {
        set({ isReady: true });
      }
    } catch {
      set({ isReady: true });
    }
  },

  login: async (phone, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api<{
        accessToken: string;
        refreshToken: string;
        driver: Driver;
      }>('/api/auth/login', {
        method: 'POST',
        body: { phone, password },
        token: null,
      });

      await storage.setTokens(data.accessToken, data.refreshToken);
      await storage.setDriver(data.driver);

      await socketService.connect();
      set({ driver: data.driver, isLoading: false });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? 'Numéro ou mot de passe incorrect'
          : 'Erreur de connexion. Vérifiez votre réseau.';
      set({ error: msg, isLoading: false });
    }
  },

  register: async (name, phone, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api<{
        accessToken: string;
        refreshToken: string;
        driver: Driver;
      }>('/api/auth/register', {
        method: 'POST',
        body: { name, phone, password },
        token: null,
      });
      await storage.setTokens(data.accessToken, data.refreshToken);
      await storage.setDriver(data.driver);
      await socketService.connect();
      set({ driver: data.driver, isLoading: false });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === 'PHONE_ALREADY_USED'
          ? 'Ce numéro est déjà utilisé'
          : 'Erreur lors de la création du compte';
      set({ error: msg, isLoading: false });
    }
  },

  logout: async () => {
    socketService.disconnect();
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    await storage.clear();
    set({ driver: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
