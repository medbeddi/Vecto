import { Platform } from 'react-native';

const fromEnv =
  typeof process.env.EXPO_PUBLIC_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')
    : '';

// 10.0.2.2 = localhost depuis l'émulateur Android ; localhost = iOS simulator
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE =
  fromEnv.length > 0 ? fromEnv : `http://${DEV_HOST}:3000`;

export const BRAND = '#E85D04';
export const BG = '#111111';
export const CARD = '#1e1e1e';
export const SURFACE = '#2a2a2a';
