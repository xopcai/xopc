import { buildDevicePairingProof, type DevicePairingAction } from '@xopcai/gateway-contract';
import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

const PROFILE_KEY = 'xopc.browser.profile';
const KEY_DATABASE = 'xopc-browser-identity';
const KEY_STORE = 'identity';
const KEY_NAME = 'device-key';
const NATIVE_HOST_NAME = 'ai.xopc.browser';
let refreshTask: Promise<BrowserGatewayProfile> | undefined;

export type BrowserGatewayProfile = {
  gatewayId: string;
  gatewayName: string;
  gatewayUrl: string;
  gatewayPublicKey: string;
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

type PairingPayload = {
  version: 3;
  pairingToken: string;
  gatewayId: string;
  gatewayName: string;
  gatewayPublicKey: string;
  routes: Array<{ id: string; url: string }>;
  expiresAt: number;
};

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
  pairingLink: string;
  expiresAt: number;
};

export async function discoverLocalGateway(): Promise<LocalGatewayBootstrap | undefined> {
  try {
    const response = await chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { type: 'bootstrap' },
    ) as Partial<LocalGatewayBootstrap> & { ok?: boolean; error?: string };
    if (response.ok !== true || typeof response.gatewayUrl !== 'string'
      || typeof response.pairingLink !== 'string' || typeof response.expiresAt !== 'number') {
      return undefined;
    }
    return {
      gatewayUrl: response.gatewayUrl,
      pairingLink: response.pairingLink,
      expiresAt: response.expiresAt,
    };
  } catch {
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

function parsePairingLink(value: string): PairingPayload {
  const url = new URL(value.trim());
  const encoded = new URLSearchParams(url.hash.slice(1)).get('p');
  if (!encoded) throw new Error('Pairing link is invalid');
  const payload = decodeJson<PairingPayload>(encoded);
  if (payload.version !== 3 || !payload.gatewayId || !payload.pairingToken || !payload.gatewayPublicKey) {
    throw new Error('Pairing link version is not supported');
  }
  if (payload.expiresAt <= Date.now()) throw new Error('Pairing link has expired');
  if (!payload.routes.length) throw new Error('Pairing link has no Gateway route');
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

async function publicKeyJwk(pair: CryptoKeyPair) {
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!exported.x || !exported.y) throw new Error('Browser identity key export failed');
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

async function requestGatewayOriginPermission(origin: string): Promise<void> {
  const url = new URL(origin);
  const pattern = `${url.origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return;
  if (!await chrome.permissions.request({ origins: [pattern] })) {
    throw new Error('Gateway site permission was not granted');
  }
}

async function post(origin: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { error?: { code?: string; message?: string } };
  if (!response.ok) throw new Error(json.error?.code ?? json.error?.message ?? `Gateway returned ${response.status}`);
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
    throw new Error('Gateway pairing response is unsigned');
  }
  if (!await verifyGateway(payload.gatewayPublicKey, response.signedPayload, response.signature)) {
    throw new Error('Gateway identity could not be verified');
  }
  const decoded = decodeJson<PairingResponse>(response.signedPayload);
  if (decoded.gateway.id !== payload.gatewayId || decoded.nonce !== nonce || decoded.request.requestId !== requestId) {
    throw new Error('Gateway pairing response does not match this request');
  }
  return decoded;
}

async function refreshAccessToken(
  gatewayUrl: string,
  refreshToken: string,
  pair: CryptoKeyPair,
): Promise<{ accessToken: string; accessTokenExpiresAt: number; refreshToken: string }> {
  const nextRefreshToken = createRefreshToken();
  const requestId = crypto.randomUUID();
  const timestamp = Date.now();
  const nonce = randomNonce();
  const credentialId = refreshToken.slice('xopc_rt_'.length).split('_')[0]!;
  const proof = `xopc-device-refresh-v2\n${credentialId}\n${timestamp}\n${nonce}\n${requestId}\n${nextRefreshToken}`;
  const signature = await sign(pair, proof);
  const response = await post(gatewayUrl, '/api/device-auth/refresh', {
    refreshToken,
    nextRefreshToken,
    requestId,
    timestamp,
    nonce,
    signature,
  }) as { payload?: { accessToken?: string; accessTokenExpiresAt?: number; refreshToken?: string } };
  if (!response.payload?.accessToken || !response.payload.accessTokenExpiresAt
    || response.payload.refreshToken !== nextRefreshToken) {
    throw new Error('Gateway returned invalid browser credentials');
  }
  return response.payload as { accessToken: string; accessTokenExpiresAt: number; refreshToken: string };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pairGateway(
  link: string,
  onApproval: (confirmationCode: string) => void,
): Promise<BrowserGatewayProfile> {
  const payload = parsePairingLink(link);
  const origin = new URL(payload.routes[0]!.url).origin;
  await requestGatewayOriginPermission(origin);
  const pair = await getOrCreateKeyPair();
  const requestId = crypto.randomUUID();
  const initialRefreshToken = createRefreshToken();
  let result = await signedPairingRequest(pair, payload, origin, requestId, 'request');
  onApproval(result.request.confirmationCode);
  while (result.request.status === 'pending') {
    await wait(1_500);
    result = await signedPairingRequest(pair, payload, origin, requestId, 'status');
  }
  if (result.request.status !== 'approved' && result.request.status !== 'completed') {
    throw new Error(`Pairing ${result.request.status}`);
  }
  if (result.request.status !== 'completed') {
    result = await signedPairingRequest(pair, payload, origin, requestId, 'complete', {
      idempotencyKey: crypto.randomUUID(),
      initialRefreshToken,
    });
  }
  if (!result.request.deviceId) throw new Error('Gateway did not register the browser');
  const tokens = await refreshAccessToken(origin, initialRefreshToken, pair);
  const profile: BrowserGatewayProfile = {
    gatewayId: payload.gatewayId,
    gatewayName: result.gateway.name,
    gatewayUrl: origin,
    gatewayPublicKey: payload.gatewayPublicKey,
    deviceId: result.request.deviceId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  };
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function readProfile(): Promise<BrowserGatewayProfile | undefined> {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  const profile = stored[PROFILE_KEY] as BrowserGatewayProfile | undefined;
  return profile?.gatewayId && profile.gatewayUrl && profile.refreshToken ? profile : undefined;
}

export async function getAccessProfile(): Promise<BrowserGatewayProfile> {
  const profile = await readProfile();
  if (!profile) throw new Error('Browser is not paired');
  if (profile.accessTokenExpiresAt > Date.now() + 30_000) return profile;
  if (refreshTask) return refreshTask;
  refreshTask = (async () => {
    const tokens = await refreshAccessToken(profile.gatewayUrl, profile.refreshToken, await getOrCreateKeyPair());
    const next = { ...profile, ...tokens };
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
  if (!response.ok) throw new Error(`Browser endpoint registration failed (${response.status})`);
}

export async function createBrowserEndpointHello(): Promise<EndpointHelloPayload> {
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
    tools: [],
  };
  return {
    ...unsigned,
    signature: await sign(pair, endpointHelloSigningPayload(unsigned)),
  };
}

export async function forgetProfile(): Promise<void> {
  await chrome.storage.local.remove(PROFILE_KEY);
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
  }
}

export async function signBrowserBridgeChallenge(payload: string): Promise<string> {
  return sign(await getOrCreateKeyPair(), payload);
}
