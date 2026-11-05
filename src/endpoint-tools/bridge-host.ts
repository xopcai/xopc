import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, lstat, writeFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import WebSocket from 'ws';
import { EndpointToolHostController, type EndpointToolRegistry, type EndpointToolApprovalRequest } from '@xopcai/endpoint-tools-client';
import { endpointHelloSigningPayload, endpointToolContentSchema, ENDPOINT_PROTOCOL_VERSION, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';

import { createLogger } from '../utils/logger.js';
import { FileProviderOperationJournal } from './provider-operation-journal.js';
import { createDeviceHostCredentials, type DeviceHostIdentity } from './host-credentials.js';

type BridgeIdentity = DeviceHostIdentity;
const log = createLogger('DeviceBridge');
async function loadIdentity(path: string): Promise<BridgeIdentity> {
  try {
    const info = await lstat(path);
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
  token?: string;
  identityPath: string;
  registry: EndpointToolRegistry;
  displayName?: string;
  confirm?: (request: EndpointToolApprovalRequest) => Promise<boolean>;
  onStateChange?: (state: string) => void;
}

/** Connects a Node hardware adapter through the existing signed Endpoint transport. */
export async function connectDeviceBridge(options: DeviceBridgeHostOptions) {
  await mkdir(dirname(options.identityPath), { recursive: true, mode: 0o700 });
  const lockPath = options.identityPath + '.lock';
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Device identity is already in use; remove a stale lock only after its host has stopped'); });
  await lock.writeFile(String(process.pid));
  let released = false;
  const release = async () => { if (released) return; released = true; await lock.close(); await unlink(lockPath).catch(() => {}); };
  try {
    const host = await connectBridge(options);
    return { ...host, async close() { await host.close(); await release(); } };
  } catch (error) { await release(); throw error; }
}

async function connectBridge(options: DeviceBridgeHostOptions) {
  const url = new URL(options.gatewayUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a Gateway origin URL without credentials or path');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Remote Bridge connections require HTTPS');
  }
  const lifetime = new AbortController();
  const identity = await loadIdentity(options.identityPath);
  const endpointId = `${identity.principalId}:bridge`;
  const displayName = options.displayName ?? 'xopc Device Bridge';
  if (!displayName.trim() || displayName.length > 80) throw new Error('Bridge name must contain 1–80 characters');
  const credentials = await createDeviceHostCredentials({ origin: url, identity, bootstrapToken: options.token, displayName, signal: lifetime.signal,
    persist: async () => {
      const temporary = options.identityPath + `.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(identity)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, options.identityPath);
        if (process.platform !== 'win32') {
          const directory = await open(dirname(options.identityPath), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      }
      finally { await unlink(temporary).catch(() => {}); }
    },
  });
  const request = async (path: string, body?: unknown, signal?: AbortSignal): Promise<any> => {
    const response = await fetch(new URL(path, url), { method: body === undefined ? 'GET' : 'POST',
      headers: await credentials.headers(body === undefined ? 'GET' : 'POST', path, body === undefined ? '' : JSON.stringify(body), { 'Content-Type': 'application/json' }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, signal ?? AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error(`Bridge Gateway request failed: HTTP ${response.status}`);
    const result = await response.json() as { ok: boolean; payload: unknown };
    if (!result.ok) throw new Error('Bridge Gateway request was rejected');
    return result.payload;
  };
  const compatibility = await request('/api/endpoint-tools/compatibility');
  if (compatibility.endpointProtocolVersion !== ENDPOINT_PROTOCOL_VERSION) throw new Error('Gateway and device Endpoint versions differ; upgrade both before connecting');
  if (compatibility.hardwareBridgeV1 !== true) throw new Error('Gateway does not support hardwareBridgeV1');
  const register = () => request('/api/endpoint-tools/principals', {
    principalId: identity.principalId, publicKey: identity.publicKey, kind: 'bridge', platform: process.platform, displayName,
  });
  await register();
  const controller = new EndpointToolHostController({ journal: new FileProviderOperationJournal(options.identityPath + '.operations'), registry: options.registry, getAvailability: () => 'background',
    createMessageId: randomUUID, confirm: options.confirm ?? (async () => false),
    onProviderCatalogAck: ack => { if (ack.accepted === false) log.warn({ endpointId, revision: ack.revision, code: ack.code }, 'Gateway rejected device capability catalog'); },
    downloadArtifact: async (artifact, context) => {
      const path = `/api/endpoint-tools/invocations/${encodeURIComponent(context.invocationId)}/artifact`;
      const response = await fetch(new URL(path, url), { redirect: 'error',
        headers: await credentials.headers('GET', path, new Uint8Array(), { 'x-endpoint-id': endpointId, 'idempotency-key': artifact.token }),
        signal: AbortSignal.any([lifetime.signal, context.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok || response.headers.get('content-length') !== String(artifact.size) || response.headers.has('content-encoding')) {
        await response.body?.cancel();
        throw new Error('Device artifact download rejected');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        bytes.fill(0);
        throw new Error('Device artifact failed integrity verification');
      }
      return bytes;
    },
    uploadFile: async (grant, file, context) => {
      if (grant.path !== `/api/endpoint-tools/invocations/${encodeURIComponent(context.invocationId)}/files`
        || grant.expiresAt <= Date.now() || file.bytes.byteLength > grant.maxBytes) throw new Error('Invalid or expired device upload grant');
      const destination = new URL(grant.path, url);
      destination.searchParams.set('name', file.name);
      const response = await fetch(destination, { method: 'POST', redirect: 'error',
        headers: await credentials.headers('POST', destination.pathname + destination.search, file.bytes, { 'Content-Type': file.mimeType,
          'x-endpoint-id': endpointId, 'x-endpoint-upload-token': grant.token }),
        body: new Uint8Array(file.bytes).buffer,
        signal: AbortSignal.any([lifetime.signal, context.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok) throw new Error(`Device upload rejected: HTTP ${response.status}`);
      const result = await response.json() as { ok: boolean; payload: unknown };
      const content = endpointToolContentSchema.parse(result.payload);
      if (!result.ok || content.type !== 'file') throw new Error('Invalid device upload response');
      return content;
    },
  });
  const clientId = randomUUID();
  const websocketUrl = new URL('/api/realtime/v1/ws', url);
  websocketUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let latestTicket = '';
  const client = new RealtimeClient({ clientId, clientKind: 'bridge', createMessageId: randomUUID,
    getWebSocketUrl: () => websocketUrl.href,
    issueTicket: async signal => {
      const ticket = await request('/api/realtime/tickets', { clientId, clientKind: 'bridge', protocolVersion: REALTIME_PROTOCOL_VERSION }, signal);
      latestTicket = ticket.ticket; return ticket;
    },
    createWebSocket: address => new WebSocket(address, { headers: credentials.connectionHeaders(latestTicket) }) as unknown as RealtimeWebSocket,
    onStateChange: state => options.onStateChange?.(state),
  });
  const processing = new Set<Promise<void>>();
  const close = async () => {
    lifetime.abort(); client.disconnect(); controller.disconnect();
    await Promise.allSettled(processing);
  };
  let resolveReady: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  client.setEndpoint({ createHello: async () => {
    await register();
    const hello: EndpointHelloPayload = { principalId: identity.principalId, endpointId, connectionInstanceId: randomUUID(),
      displayName, kind: 'bridge', platform: process.platform, appVersion: '1', availability: 'background',
      nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: options.registry.descriptors() };
    hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return hello;
  }, onReady: () => { controller.connect(message => client.sendEndpointMessage(message)); resolveReady(); },
    onMessage: message => {
      const task = controller.handleMessage(message).catch(() => {
        log.warn({ endpointId, messageType: message.type }, 'Device protocol message failed');
      });
      processing.add(task);
      void task.then(() => processing.delete(task));
    }, onDisconnected: () => controller.disconnect(!lifetime.signal.aborted) });
  client.connect();
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([ready, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Bridge endpoint did not become ready')), 15_000);
    })]);
  } catch (error) { await close(); throw error; }
  finally { clearTimeout(timeout!); }
  return { endpointId, principalId: identity.principalId, close };
}
