import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

const CLIENT_ID = 'xopc-native';
const DEFAULT_CONSOLE_URL = 'https://console.xopc.ai';
const DEFAULT_SCOPE = 'models:read models:invoke account:usage offline_access';

interface OAuthErrorResponse {
  error?: string;
  error_description?: string;
}

function consoleUrl(): string {
  return (process.env.XOPC_CONSOLE_URL ?? DEFAULT_CONSOLE_URL).replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

function credentials(body: Record<string, unknown>): OAuthCredentials {
  if (
    typeof body.access_token !== 'string' || body.access_token.length === 0 ||
    typeof body.refresh_token !== 'string' || body.refresh_token.length === 0 ||
    typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0
  ) {
    throw new Error('XOPC OAuth token response is incomplete');
  }
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expires: Date.now() + body.expires_in * 1_000,
    scope: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  };
}

async function tokenRequest(body: URLSearchParams, signal?: AbortSignal): Promise<Response> {
  return fetch(`${consoleUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: signal ?? AbortSignal.timeout(30_000),
  });
}

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const response = await fetch(`${consoleUrl()}/oauth/device_authorization`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: DEFAULT_SCOPE,
      device_name: hostname() || 'XOPC client',
      client_type: 'cli',
    }),
    signal: callbacks.signal ?? AbortSignal.timeout(30_000),
  });
  const body = await readJson(response) as Record<string, unknown> & OAuthErrorResponse;
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? 'XOPC OAuth authorization failed');
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
  const userCode = typeof body.user_code === 'string' ? body.user_code : '';
  const verificationUri = typeof body.verification_uri_complete === 'string'
    ? body.verification_uri_complete
    : typeof body.verification_uri === 'string' ? body.verification_uri : '';
  if (!deviceCode || !userCode || !verificationUri) throw new Error('XOPC OAuth response is incomplete');
  const intervalMs = Math.max(1, Number(body.interval) || 5) * 1_000;
  const expiresAt = Date.now() + Math.max(1, Number(body.expires_in) || 600) * 1_000;
  callbacks.onDeviceCode({
    userCode,
    verificationUri,
    intervalSeconds: intervalMs / 1_000,
    expiresInSeconds: Math.floor((expiresAt - Date.now()) / 1_000),
  });

  while (Date.now() < expiresAt) {
    if (callbacks.signal?.aborted) throw callbacks.signal.reason ?? new Error('OAuth login cancelled');
    await delay(intervalMs, undefined, callbacks.signal ? { signal: callbacks.signal } : undefined);
    const token = await tokenRequest(new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: deviceCode,
    }), callbacks.signal);
    const tokenBody = await readJson(token) as Record<string, unknown> & OAuthErrorResponse;
    if (token.ok) return credentials(tokenBody);
    if (tokenBody.error === 'authorization_pending' || tokenBody.error === 'slow_down') continue;
    throw new Error(tokenBody.error_description ?? tokenBody.error ?? 'XOPC OAuth token exchange failed');
  }
  throw new Error('XOPC OAuth authorization expired');
}

async function refreshToken(current: OAuthCredentials): Promise<OAuthCredentials> {
  const response = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: current.refresh,
  }));
  const body = await readJson(response) as Record<string, unknown> & OAuthErrorResponse;
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? 'XOPC OAuth refresh failed');
  return credentials(body);
}

export const xopcCloudOAuthProvider: OAuthProviderInterface = {
  id: 'xopc-cloud',
  name: 'XOPC Model Service',
  login,
  refreshToken,
  getApiKey: (value) => value.access,
};
