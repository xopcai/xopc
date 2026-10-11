import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import WebSocket from 'ws';
import { EndpointToolHostController, type EndpointToolRegistry } from '@xopcai/endpoint-tools-client';
import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';

interface BridgeIdentity { principalId: string; publicKey: string; privateKey: string }
async function loadIdentity(path: string): Promise<BridgeIdentity> {
  try {
    const info = await stat(path);
    if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Bridge identity must be a private file (mode 0600)');
    const identity = JSON.parse(await readFile(path, 'utf8')) as BridgeIdentity;
    if (!identity.principalId || !identity.publicKey || !identity.privateKey) throw new Error('Invalid Bridge identity file');
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const identity = { principalId: randomUUID(), publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
    return identity;
  }
}

export interface DeviceBridgeHostOptions {
  gatewayUrl: string;
  token: string;
  identityPath: string;
  registry: EndpointToolRegistry;
  displayName?: string;
  onStateChange?: (state: string) => void;
}

/** Connects a Node hardware adapter through the existing signed Endpoint v2 transport. */
export async function connectDeviceBridge(options: DeviceBridgeHostOptions) {
  const url = new URL(options.gatewayUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a Gateway origin URL without credentials or path');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Remote Bridge connections require HTTPS');
  }
  const lifetime = new AbortController();
  const request = async (path: string, body?: unknown, signal?: AbortSignal): Promise<any> => {
    const response = await fetch(new URL(path, url), { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, signal ?? AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error(`Bridge Gateway request failed: HTTP ${response.status}`);
    const result = await response.json() as { ok: boolean; payload: unknown };
    if (!result.ok) throw new Error('Bridge Gateway request was rejected');
    return result.payload;
  };
  const compatibility = await request('/api/endpoint-tools/compatibility');
  if (compatibility.hardwareBridgeV1 !== true) throw new Error('Gateway does not support hardwareBridgeV1');
  const identity = await loadIdentity(options.identityPath);
  const endpointId = `${identity.principalId}:bridge`;
  const displayName = options.displayName ?? 'xopc Device Bridge';
  if (!displayName.trim() || displayName.length > 80) throw new Error('Bridge name must contain 1–80 characters');
  const register = () => request('/api/endpoint-tools/principals', {
    principalId: identity.principalId, publicKey: identity.publicKey, kind: 'desktop', platform: process.platform, displayName,
  });
  await register();
  const controller = new EndpointToolHostController({ registry: options.registry, getAvailability: () => 'background',
    createMessageId: randomUUID, confirm: async () => false,
    uploadFile: async () => { throw new Error('Bridge sensors cannot upload files'); },
  });
  const clientId = randomUUID();
  const websocketUrl = new URL('/api/realtime/v1/ws', url);
  websocketUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const client = new RealtimeClient({ clientId, clientKind: 'desktop', createMessageId: randomUUID,
    getWebSocketUrl: () => websocketUrl.href,
    issueTicket: signal => request('/api/realtime/tickets', { clientId, clientKind: 'desktop', protocolVersion: REALTIME_PROTOCOL_VERSION }, signal),
    createWebSocket: address => new WebSocket(address) as unknown as RealtimeWebSocket,
    onStateChange: state => options.onStateChange?.(state),
  });
  const close = () => { lifetime.abort(); client.disconnect(); controller.disconnect(); };
  let resolveReady: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  client.setEndpoint({ createHello: async () => {
    await register();
    const hello: EndpointHelloPayload = { principalId: identity.principalId, endpointId, connectionInstanceId: randomUUID(),
      displayName, kind: 'desktop', platform: process.platform, appVersion: '1', availability: 'background',
      nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: options.registry.descriptors() };
    hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return hello;
  }, onReady: () => { controller.connect(message => client.sendEndpointMessage(message)); resolveReady(); },
    onMessage: message => { void controller.handleMessage(message); }, onDisconnected: () => controller.disconnect() });
  client.connect();
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([ready, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Bridge endpoint did not become ready')), 15_000);
    })]);
  } catch (error) { close(); throw error; }
  finally { clearTimeout(timeout!); }
  return { endpointId, principalId: identity.principalId, close };
}
