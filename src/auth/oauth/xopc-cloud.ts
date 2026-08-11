import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import { generatePKCE } from './pkce.js';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

const CLIENT_ID = 'xopc-native';
const DEFAULT_CONSOLE_URL = 'https://console.xopc.ai';
const DEFAULT_SCOPE = 'models:read models:invoke account:usage offline_access';
const CALLBACK_PATH = '/oauth/callback';
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

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

function callbackHtml(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p><p>You can close this window and return to XOPC.</p></main></body></html>`;
}

async function loginWithBrowser(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  if (callbacks.signal?.aborted) {
    throw callbacks.signal.reason instanceof Error ? callbacks.signal.reason : new Error('XOPC OAuth login cancelled');
  }
  const { verifier, challenge } = await generatePKCE();
  const state = randomBytes(24).toString('base64url');

  let settle: ((result: { code?: string; error?: Error }) => void) | undefined;
  const callback = new Promise<{ code?: string; error?: Error }>((resolve) => {
    settle = resolve;
  });
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    try {
      const url = new URL(request.url ?? '', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        response.statusCode = 404;
        response.end(callbackHtml('Authorization callback not found', 'This is not a valid XOPC OAuth callback URL.'));
        return;
      }
      const returnedState = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (returnedState !== state) {
        const error = new Error('XOPC OAuth state mismatch');
        response.statusCode = 400;
        response.end(callbackHtml('Authorization failed', error.message));
        settle?.({ error });
        return;
      }
      if (oauthError || !code) {
        const error = new Error(oauthError === 'access_denied' ? 'XOPC OAuth authorization was denied' : 'XOPC OAuth callback did not include an authorization code');
        response.statusCode = 400;
        response.end(callbackHtml('Authorization failed', error.message));
        settle?.({ error });
        return;
      }
      response.statusCode = 200;
      response.end(callbackHtml('Authorization complete', 'XOPC received the authorization callback successfully.'));
      settle?.({ code });
    } catch {
      const error = new Error('XOPC OAuth callback could not be processed');
      response.statusCode = 500;
      response.end(callbackHtml('Authorization failed', error.message));
      settle?.({ error });
    }
  });

  const redirectUri = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('XOPC OAuth callback server did not expose a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
    });
  });

  const authorizationUrl = new URL(`${consoleUrl()}/oauth/authorize`);
  authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    device_name: hostname() || 'XOPC client',
    client_type: 'cli',
  }).toString();

  const timeout = setTimeout(() => settle?.({ error: new Error('XOPC OAuth authorization timed out') }), AUTHORIZATION_TIMEOUT_MS);
  timeout.unref?.();
  const abort = () => settle?.({ error: callbacks.signal?.reason instanceof Error ? callbacks.signal.reason : new Error('XOPC OAuth login cancelled') });
  callbacks.signal?.addEventListener('abort', abort, { once: true });

  try {
    callbacks.onAuth({
      url: authorizationUrl.toString(),
      instructions: 'Complete authorization in your browser. XOPC will finish automatically after the local callback.',
    });
    const result = await callback;
    if (result.error) throw result.error;
    if (!result.code) throw new Error('XOPC OAuth callback did not include an authorization code');
    const token = await tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: result.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }), callbacks.signal);
    const body = await readJson(token) as Record<string, unknown> & OAuthErrorResponse;
    if (!token.ok) throw new Error(body.error_description ?? body.error ?? 'XOPC OAuth token exchange failed');
    return credentials(body);
  } finally {
    clearTimeout(timeout);
    callbacks.signal?.removeEventListener('abort', abort);
    server.close();
  }
}

async function loginWithDeviceCode(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
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

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const method = await callbacks.onSelect({
    message: 'Choose how to authorize XOPC Model Service',
    options: [
      { id: 'browser', label: 'Browser (recommended for this device)' },
      { id: 'device_code', label: 'Device code (remote or headless)' },
    ],
  });
  return method === 'device_code' ? loginWithDeviceCode(callbacks) : loginWithBrowser(callbacks);
}

async function refreshToken(current: OAuthCredentials, signal?: AbortSignal): Promise<OAuthCredentials> {
  const response = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: current.refresh,
  }), signal);
  const body = await readJson(response) as Record<string, unknown> & OAuthErrorResponse;
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? 'XOPC OAuth refresh failed');
  return credentials(body);
}

export const xopcCloudOAuthProvider: OAuthProviderInterface = {
  id: 'xopc-cloud',
  name: 'XOPC Model Service',
  loginMethods: ['browser', 'device_code'],
  login,
  refreshToken,
  getApiKey: (value) => value.access,
};
