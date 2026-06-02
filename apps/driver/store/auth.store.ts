import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { storage } from '../lib/storage';
import { socketService } from '../lib/socket';
import type { Driver } from '../types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL!;

type AuthState = {
  driver: Driver | null;
  phone: string | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  checkPhone: (phone: string) => Promise<boolean>;  // true = existant
  loginWithPassword: (phone: string, password: string) => Promise<void>;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  driver: null,
  phone: null,
  isReady: false,
  isLoading: false,
  error: null,

  initialize: async () => {
    try {
      const [token, driver, phone] = await Promise.all([
        storage.getAccessToken(),
        storage.getDriver(),
        storage.getPhone(),
      ]);
      if (token && driver) {
        set({ driver, phone, isReady: true });
        socketService.connect().catch(() => {});
      } else {
        set({ isReady: true });
      }
    } catch {
      set({ isReady: true });
    }
  },

  checkPhone: async (phone) => {
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.exists;
  },

  loginWithPassword: async (phone, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error ?? 'LOGIN_FAILED', res.status);

      await storage.setTokens(data.accessToken, data.refreshToken);
      await storage.setDriver(data.driver);
      await storage.setPhone(phone);
      await socketService.connect();
      set({ driver: data.driver, phone, isLoading: false });
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
        ? 'Mot de passe incorrect.'
        : 'Erreur de connexion. Réessayez.';
      set({ error: msg, isLoading: false });
      throw err;
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

  verifyOtp: async (phone, code, name, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/otp/verify/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, name, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error ?? 'VERIFY_FAILED', res.status);

      await storage.setTokens(data.accessToken, data.refreshToken);
      await storage.setDriver(data.driver);
      await storage.setPhone(phone);
      await socketService.connect();
      set({ driver: data.driver, phone, isLoading: false });
    } catch (err) {
      let msg = 'Erreur de vérification. Réessayez.';
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_OR_EXPIRED_CODE') msg = 'Code incorrect ou expiré.';
        else if (err.code === 'PASSWORD_REQUIRED') msg = 'Mot de passe requis (6 caractères min).';
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
