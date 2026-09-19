import {
  buildDevicePairingProof,
  browserPairingInvitationPayloadSchema,
  isRetryableDevicePairingHttpStatus,
  readBrowserPairingInvitation,
  type DevicePairingAction,
  type BrowserPairingInvitationPayload,
} from '@xopcai/gateway-contract';
import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

import { t } from '../i18n';
import { clearBrowserChatState } from './chat-state';

const PROFILE_KEY = 'xopc.browser.profile';
const PAIRING_JOURNAL_KEY = 'xopc.browser.pairing';
const AUTO_CONNECT_KEY = 'xopc.browser.auto-connect';
const KEY_DATABASE = 'xopc-browser-identity';
const KEY_STORE = 'identity';
const KEY_NAME = 'device-key';
const NATIVE_HOST_NAME = 'ai.xopc.browser';
const GATEWAY_REQUEST_TIMEOUT_MS = 8_000;
let refreshTask: Promise<BrowserGatewayProfile> | undefined;

export type BrowserGatewayProfile = {
  gatewayId: string;
  gatewayName: string;
  gatewayUrl: string;
  gatewayUrls?: string[];
  gatewayPublicKey: string;
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

type PairingPayload = BrowserPairingInvitationPayload;

type BrowserPairingJournal = {
  invitation: string;
  payload: PairingPayload;
  requestId: string;
  idempotencyKey: string;
  initialRefreshToken: string;
  origin?: string;
  completed?: { deviceId: string; gatewayName: string };
  refresh?: { requestId: string; nextRefreshToken: string };
  nextOrigin?: string;
};

export type PendingBrowserPairing = { invitation: string; nextOrigin?: string };

type PairingResponse = {
  request: {
    requestId: string;
    status: 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled' | 'expired';
    confirmationCode: string;
    deviceId?: string;
  };
  gateway: { id: string; name: string };
  routes?: Array<{ id: string; url: string }>;
  scopes?: string[];
  nonce: string;
};

export type LocalGatewayBootstrap = {
  gatewayUrl: string;
  invitation: string;
  expiresAt: number;
};

async function browserPublicKeyThumbprint(jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string }): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  )));
}

export async function isAutoConnectEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTO_CONNECT_KEY);
  return stored[AUTO_CONNECT_KEY] !== false;
}

export async function setAutoConnectEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_CONNECT_KEY]: enabled });
}

export async function discoverLocalGateway(options?: { force?: boolean }): Promise<LocalGatewayBootstrap | undefined> {
  try {
    if (!options?.force && !await isAutoConnectEnabled()) return undefined;
    const pair = await getOrCreateKeyPair();
    const key = await publicKeyJwk(pair);
    const nonce = randomNonce();
    const response = await chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      {
        type: 'bootstrap',
        extensionId: chrome.runtime.id,
        publicKeyJwk: key,
        publicKeyThumbprint: await browserPublicKeyThumbprint(key),
        nonce,
      },
    ) as Partial<LocalGatewayBootstrap> & { ok?: boolean; error?: string };
    if (response.ok !== true || typeof response.gatewayUrl !== 'string'
      || typeof response.invitation !== 'string' || typeof response.expiresAt !== 'number') {
      if (options?.force) throw new Error(response.error || t('errorInvalidLocalHostResponse'));
      return undefined;
    }
    return {
      gatewayUrl: response.gatewayUrl,
      invitation: response.invitation,
      expiresAt: response.expiresAt,
    };
  } catch (cause) {
    if (options?.force) throw cause;
    return undefined;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function randomNonce(bytes = 24): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function createRefreshToken(): string {
  return `xopc_rt_${crypto.randomUUID()}_${randomNonce(32)}`;
}

export function parseBrowserPairingInvitation(value: string, allowExpired = false): PairingPayload {
  const encoded = readBrowserPairingInvitation(value);
  const parsed = browserPairingInvitationPayloadSchema.safeParse(decodeJson<unknown>(encoded));
  if (!parsed.success) throw new Error('Pairing invitation version is not supported');
  const payload = parsed.data;
  if (!allowExpired && payload.expiresAt <= Date.now()) throw new Error('Pairing invitation has expired');
  return payload;
}

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedKeyPair(): Promise<CryptoKeyPair | undefined> {
  const database = await openIdentityDatabase();
  try {
    return await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
      const request = database.transaction(KEY_STORE).objectStore(KEY_STORE).get(KEY_NAME);
      request.onsuccess = () => resolve(request.result as CryptoKeyPair | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const existing = await storedKeyPair();
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const database = await openIdentityDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(pair, KEY_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
  return pair;
}

async function forgetIdentity(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(KEY_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(t('errorIdentityInUse')));
  });
}

async function publicKeyJwk(pair: CryptoKeyPair) {
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!exported.x || !exported.y) throw new Error(t('errorIdentityExport'));
  return { kty: 'EC' as const, crv: 'P-256' as const, x: exported.x, y: exported.y };
}

async function sign(pair: CryptoKeyPair, text: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(text),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifyGateway(publicKey: string, payload: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      decodeBase64Url(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

function requestGatewayOriginPermissions(origins: string[]): Promise<boolean> {
  const patterns = origins
    .filter((origin) => {
      const url = new URL(origin);
      return !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
    })
    .map(origin => `${new URL(origin).origin}/*`);
  if (!patterns.length) return Promise.resolve(true);
  // This call must happen synchronously inside the Connect click handler. Chrome
  // rejects optional permission prompts after any awaited work loses the gesture.
  return chrome.permissions.request({ origins: patterns });
}

async function hasGatewayOriginPermission(origin: string): Promise<boolean> {
  const url = new URL(origin);
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return true;
  return chrome.permissions.contains({ origins: [`${url.origin}/*`] });
}

class GatewayHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

async function post(origin: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(t('errorGatewayTimeout', String(GATEWAY_REQUEST_TIMEOUT_MS / 1_000)));
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  const json = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new GatewayHttpError(
      json.error?.code ?? json.error?.message ?? t('errorGatewayStatus', String(response.status)),
      response.status,
    );
  }
  return json as Record<string, unknown>;
}

async function signedPairingRequest(
  pair: CryptoKeyPair,
  payload: PairingPayload,
  origin: string,
  requestId: string,
  action: DevicePairingAction,
  completion?: { idempotencyKey: string; initialRefreshToken: string },
): Promise<PairingResponse> {
  const nonce = randomNonce();
  const body: Record<string, unknown> = {
    gatewayId: payload.gatewayId,
    requestId,
    pairingToken: payload.pairingToken,
    timestamp: Date.now(),
    nonce,
    ...(action === 'request' ? {
      device: {
        displayName: `Chrome · ${navigator.platform || 'Browser'}`,
        platform: 'chrome',
        extensionId: chrome.runtime.id,
        publicKeyJwk: await publicKeyJwk(pair),
      },
    } : {}),
    ...(action === 'complete' ? completion : {}),
  };
  const signature = await sign(pair, buildDevicePairingProof(action, body));
  const path = action === 'request'
    ? '/api/device-pairing/requests'
    : `/api/device-pairing/requests/${requestId}/${action}`;
  const response = await post(origin, path, { ...body, signature });
  if (typeof response.signedPayload !== 'string' || typeof response.signature !== 'string') {
    throw new Error(t('errorUnsignedPairing'));
  }
  if (!await verifyGateway(payload.gatewayPublicKey, response.signedPayload, response.signature)) {
    throw new Error(t('errorGatewayVerification'));
  }
  const decoded = decodeJson<PairingResponse>(response.signedPayload);
  if (decoded.gateway.id !== payload.gatewayId || decoded.nonce !== nonce || decoded.request.requestId !== requestId) {
    throw new Error(t('errorPairingMismatch'));
  }
  return decoded;
}

function shouldTryNextRoute(cause: unknown): boolean {
  return !(cause instanceof GatewayHttpError)
    || isRetryableDevicePairingHttpStatus(cause.status);
}

function isRouteFailure(cause: unknown): boolean {
  if (cause instanceof GatewayHttpError) return isRetryableDevicePairingHttpStatus(cause.status);
  const message = cause instanceof Error ? cause.message : String(cause);
  return /network|fetch|respond|identity|route/i.test(message);
}

async function signedPairingRequestAcrossRoutes(
  pair: CryptoKeyPair,
  payload: PairingPayload,
  origins: string[],
  requestId: string,
  action: DevicePairingAction,
  completion?: { idempotencyKey: string; initialRefreshToken: string },
): Promise<{ origin: string; result: PairingResponse }> {
  let lastRouteError: unknown;
  for (const origin of origins) {
    try {
      return { origin, result: await signedPairingRequest(pair, payload, origin, requestId, action, completion) };
    } catch (cause) {
      if (!shouldTryNextRoute(cause)) throw cause;
      lastRouteError = cause;
    }
  }
  throw lastRouteError instanceof Error ? lastRouteError : new Error('No Gateway route could be reached');
}

async function refreshAccessToken(
  gatewayUrls: string[],
  refreshToken: string,
  pair: CryptoKeyPair,
  gateway: { gatewayId: string; gatewayPublicKey: string },
  operation: { requestId: string; nextRefreshToken: string } = {
    requestId: crypto.randomUUID(),
    nextRefreshToken: createRefreshToken(),
  },
): Promise<{ accessToken: string; accessTokenExpiresAt: number; refreshToken: string; gatewayUrl: string }> {
  const { nextRefreshToken, requestId } = operation;
  const timestamp = Date.now();
  const nonce = randomNonce();
  const credentialId = refreshToken.slice('xopc_rt_'.length).split('_')[0]!;
  const proof = `xopc-device-refresh-v2\n${credentialId}\n${timestamp}\n${nonce}\n${requestId}\n${nextRefreshToken}`;
  const signature = await sign(pair, proof);
  const body = {
    refreshToken,
    nextRefreshToken,
    requestId,
    timestamp,
    nonce,
    signature,
  };
  let gatewayUrl: string | undefined;
  let response: Record<string, unknown> | undefined;
  let lastRouteError: unknown;
  for (const origin of gatewayUrls) {
    try {
      response = await post(origin, '/api/device-auth/refresh', body);
      gatewayUrl = origin;
      break;
    } catch (cause) {
      if (!shouldTryNextRoute(cause)) throw cause;
      lastRouteError = cause;
    }
  }
  if (!response || !gatewayUrl) {
    throw lastRouteError instanceof Error ? lastRouteError : new Error(t('errorNoReachableGatewayRoute'));
  }
  if (typeof response.signedPayload !== 'string' || typeof response.signature !== 'string'
    || !await verifyGateway(gateway.gatewayPublicKey, response.signedPayload, response.signature)) throw new Error(t('errorGatewayVerification'));
  const responseProof = decodeJson<{ purpose: string; gatewayId: string; requestId: string; nonce: string; expiresAt: number;
    tokens: { accessToken?: string; accessTokenExpiresAt?: number; refreshToken?: string } }>(response.signedPayload);
  if (responseProof.purpose !== 'device-refresh-v3' || responseProof.gatewayId !== gateway.gatewayId || responseProof.requestId !== requestId
    || responseProof.nonce !== nonce || !(responseProof.expiresAt > Date.now()) || responseProof.expiresAt > Date.now() + 60_000) throw new Error('Gateway refresh response does not match this request');
  const payload = responseProof.tokens;
  if (!payload?.accessToken || !payload.accessTokenExpiresAt
    || payload.refreshToken !== nextRefreshToken) {
    throw new Error(t('errorInvalidCredentials'));
  }
  return { ...payload, gatewayUrl } as {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    gatewayUrl: string;
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pairGateway(
  invitation: string,
  onApproval: (confirmationCode: string) => void,
  requestedOrigin?: string,
): Promise<BrowserGatewayProfile> {
  const payload = parseBrowserPairingInvitation(invitation, true);
  const origins = [...new Set(payload.routes.map(route => new URL(route.url).origin))];
  const selectedOrigin = requestedOrigin && origins.includes(requestedOrigin) ? requestedOrigin : origins[0]!;
  const permissionTask = requestGatewayOriginPermissions([selectedOrigin]);
  if (!await permissionTask) throw new Error('Gateway site permission was not granted');
  const permittedOrigins = (await Promise.all(origins.map(async origin => ({
    origin,
    permitted: await hasGatewayOriginPermission(origin),
  })))).filter(candidate => candidate.permitted).map(candidate => candidate.origin);
  const pair = await getOrCreateKeyPair();
  const stored = await chrome.storage.local.get(PAIRING_JOURNAL_KEY);
  let journal = stored[PAIRING_JOURNAL_KEY] as BrowserPairingJournal | undefined;
  if (journal && journal.payload.pairingToken !== payload.pairingToken) {
    throw new Error('PAIRING_ALREADY_PENDING');
  }
  if (!journal) {
    if (payload.expiresAt <= Date.now()) throw new Error(t('errorExpiredPairingLink'));
    journal = {
      invitation: invitation.trim(),
      payload,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      initialRefreshToken: createRefreshToken(),
    };
    await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
  }
  delete journal.nextOrigin;
  await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
  const requestId = journal.requestId;
  const availableOrigins = journal.origin && permittedOrigins.includes(journal.origin)
    ? [journal.origin, ...permittedOrigins.filter(candidate => candidate !== journal.origin)]
    : [selectedOrigin, ...permittedOrigins.filter(candidate => candidate !== selectedOrigin)];
  try {
    let { origin, result } = await signedPairingRequestAcrossRoutes(
      pair, journal.payload, availableOrigins, requestId, 'request',
    );
    journal.origin = origin;
    await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
    if (result.request.status === 'pending') onApproval(result.request.confirmationCode);
    while (result.request.status === 'pending') {
      await wait(1_500);
      const response = await signedPairingRequestAcrossRoutes(
        pair, journal.payload, [origin, ...permittedOrigins.filter(candidate => candidate !== origin)], requestId, 'status',
      );
      ({ origin, result } = response);
      journal.origin = origin;
      await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
    }
    if (result.request.status !== 'approved' && result.request.status !== 'completed') {
      await chrome.storage.local.remove(PAIRING_JOURNAL_KEY);
      throw new Error(t('errorPairingStatus', result.request.status));
    }
    if (result.request.status !== 'completed') {
      const response = await signedPairingRequestAcrossRoutes(
        pair, journal.payload, [origin, ...permittedOrigins.filter(candidate => candidate !== origin)], requestId, 'complete', {
          idempotencyKey: journal.idempotencyKey,
          initialRefreshToken: journal.initialRefreshToken,
        },
      );
      ({ origin, result } = response);
    }
    if (!result.request.deviceId) throw new Error(t('errorBrowserNotRegistered'));
    journal.origin = origin;
    journal.completed = { deviceId: result.request.deviceId, gatewayName: result.gateway.name };
    journal.refresh ??= { requestId: crypto.randomUUID(), nextRefreshToken: createRefreshToken() };
    await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
    const orderedOrigins = [origin, ...permittedOrigins.filter(candidate => candidate !== origin)];
    const tokens = await refreshAccessToken(
      orderedOrigins,
      journal.initialRefreshToken,
      pair,
      journal.payload,
      journal.refresh,
    );
    const profile: BrowserGatewayProfile = {
      gatewayId: journal.payload.gatewayId,
      gatewayName: journal.completed.gatewayName,
      gatewayUrl: tokens.gatewayUrl,
      gatewayUrls: [tokens.gatewayUrl, ...orderedOrigins.filter(candidate => candidate !== tokens.gatewayUrl)],
      gatewayPublicKey: journal.payload.gatewayPublicKey,
      deviceId: journal.completed.deviceId,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    };
    await chrome.storage.local.set({ [PROFILE_KEY]: profile });
    await chrome.storage.local.remove(PAIRING_JOURNAL_KEY);
    return profile;
  } catch (cause) {
    const nextOrigin = origins.find(origin => !permittedOrigins.includes(origin));
    if (nextOrigin && isRouteFailure(cause)) {
      journal.nextOrigin = nextOrigin;
      await chrome.storage.local.set({ [PAIRING_JOURNAL_KEY]: journal });
      throw new Error(`PAIRING_ROUTE_PERMISSION_REQUIRED:${nextOrigin}`);
    }
    throw cause;
  }
}

export async function readPendingBrowserPairing(): Promise<PendingBrowserPairing | undefined> {
  const stored = await chrome.storage.local.get(PAIRING_JOURNAL_KEY);
  const journal = stored[PAIRING_JOURNAL_KEY] as BrowserPairingJournal | undefined;
  return journal ? { invitation: journal.invitation, ...(journal.nextOrigin ? { nextOrigin: journal.nextOrigin } : {}) } : undefined;
}

export async function cancelPendingBrowserPairing(): Promise<void> {
  const stored = await chrome.storage.local.get(PAIRING_JOURNAL_KEY);
  const journal = stored[PAIRING_JOURNAL_KEY] as BrowserPairingJournal | undefined;
  if (!journal) return;
  const origins = [...new Set(journal.payload.routes.map(route => new URL(route.url).origin))];
  const permittedOrigins = (await Promise.all(origins.map(async origin => ({
    origin,
    permitted: await hasGatewayOriginPermission(origin),
  })))).filter(candidate => candidate.permitted).map(candidate => candidate.origin);
  try {
    await signedPairingRequestAcrossRoutes(
      await getOrCreateKeyPair(),
      journal.payload,
      journal.origin && permittedOrigins.includes(journal.origin)
        ? [journal.origin, ...permittedOrigins.filter(candidate => candidate !== journal.origin)]
        : permittedOrigins,
      journal.requestId,
      'cancel',
    );
  } catch (cause) {
    if (!(cause instanceof GatewayHttpError) || !['PAIRING_NOT_FOUND', 'PAIRING_EXPIRED', 'PAIRING_CANCELLED']
      .includes(cause.message)) throw cause;
  }
  await chrome.storage.local.remove(PAIRING_JOURNAL_KEY);
}

export async function readProfile(): Promise<BrowserGatewayProfile | undefined> {
  const stored = await chrome.storage.local.get([PROFILE_KEY, PAIRING_JOURNAL_KEY]);
  const profile = stored[PROFILE_KEY] as BrowserGatewayProfile | undefined;
  if (!profile?.gatewayId || !profile.gatewayUrl || !profile.refreshToken) return undefined;
  if (stored[PAIRING_JOURNAL_KEY]) await chrome.storage.local.remove(PAIRING_JOURNAL_KEY);
  return profile;
}

export async function getAccessProfile(): Promise<BrowserGatewayProfile> {
  const profile = await readProfile();
  if (!profile) throw new Error(t('errorBrowserNotPaired'));
  if (profile.accessTokenExpiresAt > Date.now() + 30_000) return profile;
  if (refreshTask) return refreshTask;
  refreshTask = (async () => {
    const gatewayUrls = profile.gatewayUrls?.length ? profile.gatewayUrls : [profile.gatewayUrl];
    const tokens = await refreshAccessToken(gatewayUrls, profile.refreshToken, await getOrCreateKeyPair(), profile);
    const next = {
      ...profile,
      ...tokens,
      gatewayUrls: [tokens.gatewayUrl, ...gatewayUrls.filter(candidate => candidate !== tokens.gatewayUrl)],
    };
    await chrome.storage.local.set({ [PROFILE_KEY]: next });
    return next;
  })();
  try {
    return await refreshTask;
  } finally {
    refreshTask = undefined;
  }
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let profile = await getAccessProfile();
  const request = () => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${profile.accessToken}`);
    return fetch(`${profile.gatewayUrl}${path}`, { ...init, headers });
  };
  let response = await request();
  if (response.status !== 401) return response;
  profile = { ...profile, accessTokenExpiresAt: 0 };
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
  profile = await getAccessProfile();
  response = await request();
  return response;
}

export async function registerBrowserEndpoint(): Promise<void> {
  const profile = await getAccessProfile();
  const pair = await getOrCreateKeyPair();
  const publicKey = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  const response = await gatewayFetch('/api/endpoint-tools/principals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      principalId: profile.deviceId,
      displayName: 'xopc Chrome',
      kind: 'browser',
      platform: 'chrome',
      publicKey,
    }),
  });
  if (!response.ok) throw new Error(t('errorEndpointRegistration', String(response.status)));
}

export async function createBrowserEndpointHello(
  tools: EndpointHelloPayload['tools'] = [],
): Promise<EndpointHelloPayload> {
  const profile = await getAccessProfile();
  const pair = await getOrCreateKeyPair();
  const unsigned: EndpointHelloPayload = {
    principalId: profile.deviceId,
    endpointId: `browser:${profile.deviceId}`,
    connectionInstanceId: crypto.randomUUID(),
    displayName: 'xopc Chrome',
    kind: 'browser',
    platform: 'chrome',
    appVersion: chrome.runtime.getManifest().version,
    availability: 'foreground',
    nonce: crypto.randomUUID(),
    signedAt: Date.now(),
    signature: 'pending',
    tools,
  };
  return {
    ...unsigned,
    signature: await sign(pair, endpointHelloSigningPayload(unsigned)),
  };
}

export async function forgetProfile(): Promise<void> {
  await chrome.storage.local.remove([PROFILE_KEY, PAIRING_JOURNAL_KEY]);
}

export async function revokeAndForgetProfile(): Promise<void> {
  try {
    const profile = await getAccessProfile();
    await fetch(`${profile.gatewayUrl}/api/devices/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${profile.accessToken}` },
    });
  } finally {
    await forgetProfile();
    try {
      await clearBrowserChatState();
    } finally {
      try {
        await forgetIdentity();
      } finally {
        await setAutoConnectEnabled(false);
      }
    }
  }
}

export async function signBrowserBridgeChallenge(payload: string): Promise<string> {
  return sign(await getOrCreateKeyPair(), payload);
}
