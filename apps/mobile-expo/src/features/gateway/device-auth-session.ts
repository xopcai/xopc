import { randomUUID } from 'expo-crypto';

import {
  readDeviceRefreshToken, getOrCreateDevicePrivateKey, writeDeviceRefreshToken,
  readDeviceAuthJournal, writeDeviceAuthJournal, clearDeviceAuthJournal,
} from '../../storage/device-credentials';
import { useGatewayStore } from '../../stores/gateway-store';
import type { GatewayProfile } from '../../stores/gateway-types';
import { randomNonce, signDevicePayload } from './device-crypto';

const ACCESS_EXPIRY_MARGIN_MS = 30_000;
const refreshTasks = new Map<string, Promise<DeviceTokens>>();
type RefreshAttempt = { refreshToken: string; nextRefreshToken: string; requestId: string };
export type DeviceTokens = { accessToken: string; accessTokenExpiresAt: number; refreshToken: string; refreshTokenExpiresAt: number };

export function createDeviceRefreshToken(): string {
  return `xopc_rt_${randomUUID()}_${randomNonce(32)}`;
}

/** Recovery journal is written before the first network attempt, including after app restart. */
export async function refreshCredentialsForProfile(profile: GatewayProfile): Promise<DeviceTokens> {
  const key = profile.gatewayId;
  const refreshToken = readDeviceRefreshToken(key);
  if (!refreshToken) throw new Error('DEVICE_CREDENTIALS_MISSING');
  const taskKey = `${key}:${refreshToken}`;
  const existing = refreshTasks.get(taskKey);
  if (existing) return existing;
  const task = (async () => {
    const journalKey = `refresh.${key}`;
    let attempt = readDeviceAuthJournal<RefreshAttempt>(journalKey);
    if (!attempt || attempt.refreshToken !== refreshToken) {
      attempt = { refreshToken, nextRefreshToken: createDeviceRefreshToken(), requestId: randomUUID() };
      writeDeviceAuthJournal(journalKey, attempt);
    }
    const timestamp = Date.now();
    const nonce = randomNonce();
    const credentialId = refreshToken.slice('xopc_rt_'.length).split('_')[0];
    const signature = signDevicePayload(getOrCreateDevicePrivateKey(),
      `xopc-device-refresh-v2\n${credentialId}\n${timestamp}\n${nonce}\n${attempt.requestId}\n${attempt.nextRefreshToken}`);
    const routes = [...profile.routes.filter(r => r.id === profile.activeRouteId), ...profile.routes.filter(r => r.id !== profile.activeRouteId)];
    let lastError: unknown;
    for (const route of routes) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`${route.url}/api/device-auth/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ ...attempt, timestamp, nonce, signature }),
        });
        if (response.status === 401 || response.status === 403) throw new Error('DEVICE_AUTH_DENIED');
        const body = await response.json() as { payload?: DeviceTokens };
        if (!response.ok || !body.payload?.accessToken || body.payload.refreshToken !== attempt.nextRefreshToken
          || !(body.payload.accessTokenExpiresAt > Date.now()) || !(body.payload.refreshTokenExpiresAt > Date.now())) {
          throw new Error('DEVICE_REFRESH_FAILED');
        }
        if (readDeviceRefreshToken(key) !== refreshToken) throw new Error('DEVICE_AUTH_SUPERSEDED');
        writeDeviceRefreshToken(key, body.payload.refreshToken);
        clearDeviceAuthJournal(journalKey);
        return body.payload;
      } catch (error) {
        if (error instanceof Error && ['DEVICE_AUTH_DENIED', 'DEVICE_AUTH_SUPERSEDED'].includes(error.message)) throw error;
        lastError = error;
      } finally { clearTimeout(timer); }
    }
    throw new Error('No secure gateway route is reachable', { cause: lastError });
  })();
  refreshTasks.set(taskKey, task);
  try { return await task; } finally { refreshTasks.delete(taskKey); }
}

export async function refreshDeviceAccessToken(): Promise<string> {
  const before = useGatewayStore.getState();
  const profile = before.getActiveProfile();
  if (!profile) throw new Error('No paired gateway is active');
  const generation = before.connectionGeneration;
  try {
    const tokens = await refreshCredentialsForProfile(profile);
    const current = useGatewayStore.getState();
    if (current.activeGatewayId !== profile.gatewayId || current.connectionGeneration !== generation) throw new Error('DEVICE_AUTH_SUPERSEDED');
    current.setAccessToken(tokens.accessToken, tokens.accessTokenExpiresAt);
    return tokens.accessToken;
  } catch (error) {
    const current = useGatewayStore.getState();
    if (current.activeGatewayId === profile.gatewayId && current.connectionGeneration === generation
      && error instanceof Error && ['DEVICE_AUTH_DENIED', 'DEVICE_CREDENTIALS_MISSING'].includes(error.message)) current.onUnauthorized();
    throw error;
  }
}

export async function getDeviceAccessToken(): Promise<string> {
  const { accessToken, accessTokenExpiresAt } = useGatewayStore.getState();
  if (accessToken && accessTokenExpiresAt > Date.now() + ACCESS_EXPIRY_MARGIN_MS) return accessToken;
  return refreshDeviceAccessToken();
}

/** @internal */
export function resetDeviceAuthSessionForTests(): void { refreshTasks.clear(); }
