/**
 * OpenAI Codex (ChatGPT) OAuth.
 *
 * Owns callback validation, manual prompt handling, and success/error pages.
 */

import { randomBytes } from 'node:crypto';
import http from 'node:http';

import { generatePKCE } from './pkce.js';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = 'openid profile email offline_access';
const MANUAL_PROMPT_DELAY_MS = 15_000;
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

type TokenResponseJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type CallbackResult =
  | { type: 'code'; code: string }
  | { type: 'unavailable' };

type LocalOAuthServer = {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<CallbackResult>;
  available: boolean;
};

function xopcOAuthHtml(params: { title: string; message: string; tone: 'success' | 'error' }): string {
  const color = params.tone === 'success' ? '#2563eb' : '#dc2626';
  const escapedTitle = escapeHtml(params.title);
  const escapedMessage = escapeHtml(params.message);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    @media (prefers-color-scheme: dark) { body { background: #020617; color: #e2e8f0; } .card { background: #0f172a !important; border-color: #1e293b !important; } .muted { color: #94a3b8 !important; } }
    .card { width: min(520px, calc(100vw - 32px)); background: white; border: 1px solid #e2e8f0; border-radius: 20px; padding: 28px; box-sizing: border-box; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; font-weight: 700; }
    .logo { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; color: white; background: ${color}; font-weight: 800; letter-spacing: -0.04em; }
    h1 { font-size: 22px; margin: 0 0 10px; }
    p { margin: 0; line-height: 1.6; }
    .muted { color: #64748b; margin-top: 14px; font-size: 14px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><div class="logo">x</div><div>xopc</div></div>
    <h1>${escapedTitle}</h1>
    <p>${escapedMessage}</p>
    <p class="muted">You can close this window and return to the terminal.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

function createState(): string {
  return randomBytes(16).toString('hex');
}

function waitForManualPromptDelay(signal?: AbortSignal): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'));
      return;
    }
    const timeout = setTimeout(() => resolve({ type: 'unavailable' }), MANUAL_PROMPT_DELAY_MS);
    timeout.unref?.();
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Login cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function parseOAuthAuthorizationInput(input: string): { code?: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};

  try {
    const url = new URL(trimmed);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Continue: raw code or query-string paste.
  }

  if (trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: trimmed };
}

async function parsePromptedAuthorizationCode(inputPromise: Promise<string>, state: string): Promise<string> {
  const input = await inputPromise;
  const parsed = parseOAuthAuthorizationInput(input);
  if (parsed.state && parsed.state !== state) {
    throw new Error('State mismatch. Paste the redirect URL from the most recent xopc OAuth login.');
  }
  if (!parsed.code) {
    throw new Error('Missing authorization code');
  }
  return parsed.code;
}

async function createAuthorizationFlow(): Promise<{ verifier: string; state: string; url: string }> {
  const { verifier, challenge } = await generatePKCE();
  const state = createState();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'xopc');
  return { verifier, state, url: url.toString() };
}

async function startLocalOAuthServer(state: string): Promise<LocalOAuthServer> {
  let settleWait: ((value: CallbackResult) => void) | undefined;
  const waitForCodePromise = new Promise<CallbackResult>((resolve) => {
    let settled = false;
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end(xopcOAuthHtml({ title: 'Callback route not found', message: 'This xopc OAuth callback URL is not valid.', tone: 'error' }));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end(xopcOAuthHtml({ title: 'Authentication failed', message: 'OpenAI did not return an authorization code.', tone: 'error' }));
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end(
          xopcOAuthHtml({
            title: 'Authentication needs manual confirmation',
            message: 'This callback belongs to a different xopc OAuth attempt. Copy the full URL from the address bar and paste it in the terminal prompt for the latest login.',
            tone: 'error',
          }),
        );
        settleWait?.({ type: 'unavailable' });
        return;
      }

      res.statusCode = 200;
      res.end(xopcOAuthHtml({ title: 'OpenAI authentication complete', message: 'xopc received the authorization callback successfully.', tone: 'success' }));
      settleWait?.({ type: 'code', code });
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(xopcOAuthHtml({ title: 'Authentication failed', message: 'xopc could not process the OAuth callback.', tone: 'error' }));
    }
  });

  return new Promise((resolve) => {
    server
      .listen(CALLBACK_PORT, () => {
        resolve({
          available: true,
          close: () => server.close(),
          cancelWait: () => settleWait?.({ type: 'unavailable' }),
          waitForCode: () => waitForCodePromise,
        });
      })
      .on('error', () => {
        resolve({
          available: false,
          close: () => {},
          cancelWait: () => settleWait?.({ type: 'unavailable' }),
          waitForCode: async () => ({ type: 'unavailable' }),
        });
      });
  });
}

async function postTokenForm(body: URLSearchParams, signal?: AbortSignal): Promise<TokenResponseJson> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: signal ?? AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI Codex token request failed (${response.status}): ${text || response.statusText}`);
  }
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`OpenAI Codex token response was not JSON: ${contentType || 'missing content-type'}`);
  }
  return JSON.parse(text) as TokenResponseJson;
}

async function exchangeAuthorizationCode(code: string, verifier: string, signal?: AbortSignal): Promise<OAuthCredentials> {
  const json = await postTokenForm(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
    signal,
  );
  return normalizeTokenResponse(json);
}

async function refreshAccessToken(refreshToken: string): Promise<OAuthCredentials> {
  const json = await postTokenForm(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  );
  return normalizeTokenResponse(json);
}

function normalizeTokenResponse(json: TokenResponseJson): OAuthCredentials {
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    const missing = [
      !json.access_token ? 'access_token' : '',
      !json.refresh_token ? 'refresh_token' : '',
      typeof json.expires_in !== 'number' ? 'expires_in' : '',
    ].filter(Boolean).join(', ');
    throw new Error(`OpenAI Codex token response missing fields: ${missing}`);
  }
  const accountId = getAccountId(json.access_token);
  if (!accountId) {
    throw new Error('Failed to extract accountId from token');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

function getAccountId(accessToken: string): string | null {
  const [, payload] = accessToken.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
    const authClaim = json['https://api.openai.com/auth'];
    if (authClaim && typeof authClaim === 'object') {
      const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
      if (typeof accountId === 'string' && accountId.length > 0) return accountId;
    }
    return typeof json.sub === 'string' && json.sub.length > 0 ? json.sub : null;
  } catch {
    return null;
  }
}

export async function loginOpenAICodex(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, state, url } = await createAuthorizationFlow();
  const server = await startLocalOAuthServer(state);

  try {
    callbacks.onAuth({
      url,
      instructions: server.available
        ? 'A browser window should open. Complete login to finish. If it does not complete automatically, paste the final redirect URL in the terminal.'
        : 'Open this URL and paste the final redirect URL in the terminal. xopc could not bind localhost:1455 for the automatic callback.',
    });

    let code: string | undefined;
    if (server.available) {
      const callback = await Promise.race([server.waitForCode(), waitForManualPromptDelay(callbacks.signal)]);
      if (callback.type === 'code') {
        code = callback.code;
      }
    }

    if (!code) {
      const manualInput = callbacks.onManualCodeInput
        ? callbacks.onManualCodeInput()
        : callbacks.onPrompt({ message: 'Paste the authorization code (or full redirect URL):' });
      const manualCode = parsePromptedAuthorizationCode(manualInput, state).then((value) => {
        server.cancelWait();
        return { type: 'code' as const, code: value };
      });
      const callback = await Promise.race([server.waitForCode(), manualCode]);
      if (callback.type === 'code') {
        code = callback.code;
      }
    }

    if (!code) {
      throw new Error('Missing authorization code');
    }

    return await exchangeAuthorizationCode(code, verifier, callbacks.signal);
  } finally {
    server.close();
  }
}

export async function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials> {
  return refreshAccessToken(refreshToken);
}

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
  id: 'openai-codex',
  name: 'OpenAI Codex',
  usesCallbackServer: true,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    return loginOpenAICodex(callbacks);
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    return refreshOpenAICodexToken(credentials.refresh);
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
