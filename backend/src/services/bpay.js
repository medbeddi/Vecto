import axios from 'axios';
import { env } from '../config/env.js';

const BASE_URL = env.BPAY_API_URL;

// Cache du token en mémoire (30s de marge avant expiry)
let tokenCache = null;

async function authenticate() {
  const params = new URLSearchParams({
    grant_type: 'password',
    username: env.BPAY_USERNAME,
    password: env.BPAY_PASSWORD,
    client_id: 'ebankily',
  });
  const { data } = await axios.post(`${BASE_URL}/authentification`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  const now = Date.now();
  tokenCache = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt: now + (parseInt(data.expires_in, 10) - 30) * 1000,
    refreshExpiresAt: now + (parseInt(data.refresh_expires_in, 10) - 30) * 1000,
  };
  return data.access_token;
}

async function refreshToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenCache.refresh_token,
    client_id: 'ebankily',
  });
  const { data } = await axios.post(`${BASE_URL}/authentification`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  const now = Date.now();
  tokenCache = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt: now + (parseInt(data.expires_in, 10) - 30) * 1000,
    refreshExpiresAt: now + (parseInt(data.refresh_expires_in, 10) - 30) * 1000,
  };
  return data.access_token;
}

async function getToken() {
  const now = Date.now();
  if (!tokenCache || now >= tokenCache.refreshExpiresAt) return authenticate();
  if (now >= tokenCache.expiresAt) return refreshToken();
  return tokenCache.access_token;
}

function isTimeout(err) {
  return (
    err.code === 'ECONNABORTED' ||
    err.code === 'ETIMEDOUT' ||
    err.message?.includes('timeout') ||
    !err.response
  );
}

/**
 * Lance un paiement B-PAY.
 * Retourne { errorCode, errorMessage, transactionId }
 */
export async function processPayment({ clientPhone, passcode, operationId, amount }) {
  const token = await getToken();
  const { data } = await axios.post(
    `${BASE_URL}/payment`,
    {
      clientPhone,
      passcode,
      operationId,
      amount: String(amount),
      language: 'FR',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30_000,
    }
  );
  return data;
}

/**
 * Vérifie le statut d'une transaction par operationId.
 * Retourne { errorCode, errorMessage, transactionId, status } (TS/TF/TA)
 */
export async function checkTransaction(operationId) {
  const token = await getToken();
  const { data } = await axios.post(
    `${BASE_URL}/checkTransaction`,
    { operationId },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 15_000,
    }
  );
  return data;
}

export { isTimeout };
