import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { storage } from '../lib/storage';
import { socketService } from '../lib/socket';
import type { Driver } from '../types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL!;

type AuthState = {
  driver: Driver | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string, name?: string) => Promise<void>;
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

  sendOtp: async (phone) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new ApiError(data.error ?? 'SEND_FAILED', res.status);
      }
      set({ isLoading: false });
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 'INVALID_PHONE'
        ? 'Numéro de téléphone invalide'
        : 'Impossible d\'envoyer le code. Vérifiez votre réseau.';
      set({ error: msg, isLoading: false });
      throw err;
    }
  },

  verifyOtp: async (phone, code, name) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/otp/verify/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error ?? 'VERIFY_FAILED', res.status);

      await storage.setTokens(data.accessToken, data.refreshToken);
      await storage.setDriver(data.driver);
      await socketService.connect();
      set({ driver: data.driver, isLoading: false });
    } catch (err) {
      let msg = 'Erreur de vérification. Réessayez.';
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_OR_EXPIRED_CODE') msg = 'Code incorrect ou expiré.';
        else if (err.code === 'NAME_REQUIRED') msg = 'Nom requis pour créer un compte.';
      }
      set({ error: msg, isLoading: false });
      throw err;
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
