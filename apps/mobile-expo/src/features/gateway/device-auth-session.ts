import { randomUUID } from 'expo-crypto';

import { readDeviceRefreshToken, getOrCreateDevicePrivateKey, writeDeviceRefreshToken } from '../../storage/device-credentials';
import { useGatewayStore } from '../../stores/gateway-store';
import { randomNonce, signDevicePayload } from './device-crypto';

const ACCESS_EXPIRY_MARGIN_MS = 30_000;
let refreshTask: Promise<string> | null = null;

function refreshCredentialId(refreshToken: string): string {
  if (!refreshToken.startsWith('xopc_rt_')) throw new Error('Invalid refresh credential');
  const value = refreshToken.slice('xopc_rt_'.length);
  const separator = value.indexOf('_');
  if (separator < 1) throw new Error('Invalid refresh credential');
  return value.slice(0, separator);
}

export async function refreshDeviceAccessToken(): Promise<string> {
  if (refreshTask) return refreshTask;
  refreshTask = (async () => {
    const store = useGatewayStore.getState();
    const profile = store.getActiveProfile();
    if (!profile) throw new Error('No paired gateway is active');
    const refreshToken = readDeviceRefreshToken(profile.gatewayId);
    if (!refreshToken) throw new Error('Device credentials are unavailable; pair this phone again');
    const timestamp = Date.now();
    const nonce = randomNonce();
    const requestId = randomUUID();
    const nextRefreshToken = `xopc_rt_${randomUUID()}_${randomNonce(32)}`;
    const message = `xopc-device-refresh-v2\n${refreshCredentialId(refreshToken)}\n${timestamp}\n${nonce}\n${requestId}\n${nextRefreshToken}`;
    const signature = signDevicePayload(getOrCreateDevicePrivateKey(), message);
    const routes = [
      ...profile.routes.filter((route) => route.id === profile.activeRouteId),
      ...profile.routes.filter((route) => route.id !== profile.activeRouteId),
    ];
    let lastError: unknown;
    for (const route of routes) {
      try {
        const response = await fetch(`${route.url}/api/device-auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken, timestamp, nonce, requestId, nextRefreshToken, signature }),
        });
        const body = await response.json().catch(() => ({})) as {
          payload?: { accessToken?: string; accessTokenExpiresAt?: number; refreshToken?: string };
          error?: { message?: string };
        };
        if (response.status === 401 || response.status === 403) {
          store.onUnauthorized();
          throw new Error(body.error?.message ?? 'Device authorization failed');
        }
        if (!response.ok) {
          throw new Error(body.error?.message ?? `Gateway request failed (${response.status})`);
        }
        if (!body.payload?.accessToken || !body.payload.refreshToken || !body.payload.accessTokenExpiresAt) {
          throw new Error('Gateway returned invalid device credentials');
        }
        writeDeviceRefreshToken(profile.gatewayId, body.payload.refreshToken);
        store.setAccessToken(body.payload.accessToken, body.payload.accessTokenExpiresAt);
        if (route.id !== profile.activeRouteId) store.selectRoute(profile.gatewayId, route.id);
        return body.payload.accessToken;
      } catch (error) {
        if (useGatewayStore.getState().unauthorized) throw error;
        lastError = error;
      }
    }
    throw new Error('No secure gateway route is reachable', { cause: lastError });
  })();
  try {
    return await refreshTask;
  } finally {
    refreshTask = null;
  }
}

export async function getDeviceAccessToken(): Promise<string> {
  const { accessToken, accessTokenExpiresAt } = useGatewayStore.getState();
  if (accessToken && accessTokenExpiresAt > Date.now() + ACCESS_EXPIRY_MARGIN_MS) return accessToken;
  return refreshDeviceAccessToken();
}

/** @internal */
export function resetDeviceAuthSessionForTests(): void {
  refreshTask = null;
}
