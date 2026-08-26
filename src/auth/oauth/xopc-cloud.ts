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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function callbackHtml(
  title: string,
  message: string,
  tone: 'success' | 'error',
  returnToAppUrl?: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeReturnToAppUrl = returnToAppUrl?.startsWith('xopc://')
    ? escapeHtml(returnToAppUrl)
    : undefined;
  const statusLabel = tone === 'success' ? 'Authorization successful' : 'Authorization needs attention';
  const statusIcon = tone === 'success'
    ? '<path d="m7.5 12 3 3 6-7" />'
    : '<path d="M12 8v5m0 3.5v.01" />';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${safeTitle} · XOPC</title>
  <style>
    :root {
      color-scheme: light dark;
      --accent: #3a6bff;
      --accent-soft: #eef3ff;
      --canvas: #f7f8fb;
      --panel: rgba(255, 255, 255, 0.88);
      --text: #111111;
      --muted: #666666;
      --edge: rgba(17, 17, 17, 0.08);
      --status: ${tone === 'success' ? '#17864b' : '#d64242'};
      --status-soft: ${tone === 'success' ? '#e7fbf1' : '#fff0f0'};
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      overflow: hidden;
      padding: 24px;
      background:
        radial-gradient(circle at 18% 18%, rgba(46, 216, 255, 0.16), transparent 34rem),
        radial-gradient(circle at 82% 78%, rgba(91, 87, 255, 0.14), transparent 32rem),
        var(--canvas);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }
    .glow {
      position: fixed;
      width: 280px;
      height: 280px;
      border-radius: 999px;
      background: rgba(58, 107, 255, 0.12);
      filter: blur(72px);
      pointer-events: none;
    }
    .glow-one { top: -120px; right: -80px; }
    .glow-two { bottom: -150px; left: -80px; }
    .card {
      position: relative;
      width: min(100%, 480px);
      padding: 34px;
      overflow: hidden;
      border: 1px solid var(--edge);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: 0 24px 80px rgba(31, 41, 78, 0.12), 0 2px 12px rgba(17, 17, 17, 0.05);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 34px; font-weight: 700; letter-spacing: -0.02em; }
    .logo { width: 38px; height: 38px; filter: drop-shadow(0 8px 14px rgba(58, 107, 255, 0.22)); }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 18px;
      border-radius: 999px;
      padding: 7px 11px 7px 8px;
      background: var(--status-soft);
      color: var(--status);
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.01em;
    }
    .status-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    h1 { margin: 0; font-size: clamp(26px, 6vw, 32px); line-height: 1.15; letter-spacing: -0.035em; }
    .message { margin: 14px 0 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
    .next-step {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      margin-top: 28px;
      padding-top: 22px;
      border-top: 1px solid var(--edge);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .window-icon { flex: none; width: 18px; height: 18px; margin-top: 1px; color: var(--accent); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .return-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 22px;
      min-height: 42px;
      border-radius: 12px;
      padding: 0 16px;
      background: var(--accent);
      color: #fff;
      font-size: 14px;
      font-weight: 650;
      text-decoration: none;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --accent-soft: rgba(58, 107, 255, 0.16);
        --canvas: #090a0d;
        --panel: rgba(20, 22, 28, 0.9);
        --text: #f7f8fb;
        --muted: #a6a9b2;
        --edge: rgba(255, 255, 255, 0.09);
        --status: ${tone === 'success' ? '#63d69a' : '#ff8484'};
        --status-soft: ${tone === 'success' ? 'rgba(44, 203, 127, 0.12)' : 'rgba(255, 93, 93, 0.12)'};
      }
      body {
        background:
          radial-gradient(circle at 18% 18%, rgba(46, 216, 255, 0.09), transparent 34rem),
          radial-gradient(circle at 82% 78%, rgba(91, 87, 255, 0.12), transparent 32rem),
          var(--canvas);
      }
      .card { box-shadow: 0 26px 90px rgba(0, 0, 0, 0.42); }
    }
    @media (max-width: 520px) {
      body { padding: 16px; }
      .card { padding: 26px 22px; border-radius: 20px; }
      .brand { margin-bottom: 28px; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .card { animation: enter 420ms cubic-bezier(.2, .75, .25, 1) both; }
      .status-icon { animation: settle 520ms 160ms cubic-bezier(.2, .8, .25, 1.25) both; }
      @keyframes enter { from { opacity: 0; transform: translateY(10px) scale(.985); } }
      @keyframes settle { from { opacity: 0; transform: scale(.65); } }
    }
  </style>
</head>
<body>
  <div class="glow glow-one"></div>
  <div class="glow glow-two"></div>
  <main class="card">
    <div class="brand">
      <svg class="logo" viewBox="0 0 72 72" aria-hidden="true">
        <rect width="72" height="72" rx="20" fill="#3a6bff" />
        <path d="M22 22l28 28M50 22 22 50" stroke="#fff" stroke-width="8" stroke-linecap="round" />
      </svg>
      <span>XOPC</span>
    </div>
    <div class="status">
      <svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true">${statusIcon}</svg>
      <span>${statusLabel}</span>
    </div>
    <h1>${safeTitle}</h1>
    <p class="message">${safeMessage}</p>
    ${safeReturnToAppUrl ? `<a id="return-to-xopc" class="return-button" href="${safeReturnToAppUrl}">Open XOPC</a>` : ''}
    <div class="next-step">
      <svg class="window-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></svg>
      <span>You can safely close this window and return to XOPC.</span>
    </div>
  </main>
  ${safeReturnToAppUrl ? `<script>
    window.setTimeout(function () {
      var link = document.getElementById('return-to-xopc');
      if (link) window.location.href = link.href;
    }, 350);
  </script>` : ''}
</body>
</html>`;
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
        response.end(callbackHtml('Authorization callback not found', 'This is not a valid XOPC OAuth callback URL.', 'error'));
        return;
      }
      const returnedState = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (returnedState !== state) {
        const error = new Error('XOPC OAuth state mismatch');
        response.statusCode = 400;
        response.end(callbackHtml('Authorization failed', error.message, 'error'));
        settle?.({ error });
        return;
      }
      if (oauthError || !code) {
        const error = new Error(oauthError === 'access_denied' ? 'XOPC OAuth authorization was denied' : 'XOPC OAuth callback did not include an authorization code');
        response.statusCode = 400;
        response.end(callbackHtml('Authorization failed', error.message, 'error'));
        settle?.({ error });
        return;
      }
      response.statusCode = 200;
      response.end(callbackHtml(
        'Authorization complete',
        'XOPC received the authorization callback successfully.',
        'success',
        callbacks.returnToAppUrl,
      ));
      settle?.({ code });
    } catch {
      const error = new Error('XOPC OAuth callback could not be processed');
      response.statusCode = 500;
      response.end(callbackHtml('Authorization failed', error.message, 'error'));
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
