import * as SecureStore from 'expo-secure-store';
import type { Driver } from '../types';

const K = {
  ACCESS: 'at',
  REFRESH: 'rt',
  DRIVER: 'drv',
  PHONE: 'ph',
} as const;

export const storage = {
  async setTokens(access: string, refresh: string) {
    await SecureStore.setItemAsync(K.ACCESS, access);
    await SecureStore.setItemAsync(K.REFRESH, refresh);
  },

  getAccessToken: () => SecureStore.getItemAsync(K.ACCESS),
  getRefreshToken: () => SecureStore.getItemAsync(K.REFRESH),

  setPhone: (phone: string) => SecureStore.setItemAsync(K.PHONE, phone),
  getPhone: () => SecureStore.getItemAsync(K.PHONE),

  async setDriver(driver: Driver) {
    await SecureStore.setItemAsync(K.DRIVER, JSON.stringify(driver));
  },

  async getDriver(): Promise<Driver | null> {
    const raw = await SecureStore.getItemAsync(K.DRIVER);
    return raw ? (JSON.parse(raw) as Driver) : null;
  },

  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(K.ACCESS),
      SecureStore.deleteItemAsync(K.REFRESH),
      SecureStore.deleteItemAsync(K.DRIVER),
      SecureStore.deleteItemAsync(K.PHONE),
    ]);
  },
};
