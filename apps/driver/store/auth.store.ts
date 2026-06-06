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
  resetPassword: (phone: string, code: string, newPassword: string) => Promise<void>;
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
      let msg = 'Erreur de connexion. Réessayez.';
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CREDENTIALS') msg = 'Numéro ou mot de passe incorrect.';
        else if (err.status === 429) msg = 'Trop de tentatives. Réessayez dans 15 minutes.';
      }
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
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error ?? 'SEND_FAILED', res.status);
      // En dev, le backend retourne le code directement pour faciliter les tests
      if (data.code) {
        const { Alert } = await import('react-native');
        Alert.alert('Code OTP (dev)', `Votre code : ${data.code}`);
      }
      set({ isLoading: false });
    } catch (err) {
      let msg = 'Impossible d\'envoyer le code. Vérifiez votre réseau.';
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_PHONE') msg = 'Numéro de téléphone invalide';
        else if (err.status === 429) msg = 'Trop de tentatives. Réessayez dans 15 minutes.';
      }
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

  resetPassword: async (phone, code, newPassword) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, newPassword }),
      });
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) throw new ApiError((data.error as string) ?? 'RESET_FAILED', res.status);

      await storage.setTokens(data.accessToken as string, data.refreshToken as string);
      await storage.setDriver(data.driver as import('../types').Driver);
      await storage.setPhone(phone);
      await socketService.connect();
      set({ driver: data.driver as import('../types').Driver, phone, isLoading: false });
    } catch (err) {
      let msg = 'Erreur de réinitialisation. Réessayez.';
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_OR_EXPIRED_CODE') msg = 'Code incorrect ou expiré.';
        else if (err.code === 'PASSWORD_TOO_SHORT') msg = 'Mot de passe trop court (6 caractères min).';
        else if (err.code === 'DRIVER_NOT_FOUND') msg = 'Compte introuvable.';
        else if (err.status === 429) msg = 'Trop de tentatives. Réessayez dans 15 minutes.';
        else msg = `Erreur : ${err.code} (${err.status})`;
      }
      console.warn('[resetPassword] échec:', err instanceof ApiError ? `${err.code} ${err.status}` : String(err));
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
