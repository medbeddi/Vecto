import { Platform } from 'react-native';

const fromEnv =
  typeof process.env.EXPO_PUBLIC_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')
    : '';

const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE =
  fromEnv.length > 0 ? fromEnv : `http://${DEV_HOST}:3000`;

// Couleurs — thème clair
export const BRAND   = '#E85D04';      // orange accent
export const PRIMARY = '#1A1A1A';      // boutons principaux, texte fort
export const BG      = '#F5F5F5';      // fond global
export const CARD    = '#FFFFFF';      // cartes blanches
export const SURFACE = '#F0F0F0';      // surface légèrement grisée
export const BORDER  = '#EBEBEB';      // séparateurs

export const TEXT    = '#1A1A1A';      // texte principal
export const TEXT2   = '#888888';      // texte secondaire

// Bulles de chat
export const BUBBLE_DRIVER = '#1A1A1A';  // fond bulle livreur (sombre)
export const BUBBLE_CLIENT = '#F0F0F0';  // fond bulle client (clair)
