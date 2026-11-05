import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { RemoteGatewayUpstream } from '../gateway/remote-upstream.js';

const keys = generateKeyPairSync('ed25519');
const identity = { gatewayId: randomUUID(), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const token = 'synthetic-owner-token';
let upstream: RemoteGatewayUpstream;
let server: ReturnType<typeof createServer>;
let calls: Array<{ path?: string; credential?: string }>;
let mode: string;
let origin: string;

beforeEach(async () => {
  calls = []; mode = '';
  server = createServer(async (req, res) => {
    calls.push({ path: req.url, credential: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://other.invalid' }).end('{}'); return; }
    if (mode === 'throttle') { res.writeHead(429, { 'Retry-After': '2' }).end('{}'); return; }
    if (req.url === '/api/desktop-host/compatibility') {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('{}'); return; }
      res.end(JSON.stringify({ ok: true, payload: { ...identity, manifest: {}, capabilities: {} } })); return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { nonce } = JSON.parse(Buffer.concat(chunks).toString());
    const now = Date.now();
    const signedPayload = Buffer.from(JSON.stringify({ purpose: 'gateway-route-v1', gatewayId: mode === 'changed' ? randomUUID() : identity.gatewayId,
      nonce: mode === 'nonce' ? 'wrong' : nonce, serverTime: now, expiresAt: now + 30_000, requestProofVersion: 1 })).toString('base64url');
    res.end(JSON.stringify({ signedPayload, signature: sign(null, Buffer.from(signedPayload), keys.privateKey).toString('base64url') }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  upstream = new RemoteGatewayUpstream({ origin, transport: 'ssh', token });
});
afterEach(async () => { upstream.close(); await new Promise<void>(resolve => server.close(() => resolve())); });

it('discovers and proves identity through the shared desktop compatibility API', async () => {
  expect(await upstream.authenticate()).toEqual(identity);
  expect(calls.map(call => call.path)).toEqual(['/api/desktop-host/compatibility', '/api/gateway-identity/challenge']);
  expect(calls[1].credential).toBeUndefined();
  calls = [];
  expect(await upstream.authenticate()).toEqual(identity);
  expect(calls[0]).toEqual({ path: '/api/gateway-identity/challenge', credential: undefined });
});

it('proves a persisted identity before sending the saved credential, including SSH localhost', async () => {
  const pinned = new RemoteGatewayUpstream({ origin: origin.replace('127.0.0.1', 'localhost'), transport: 'ssh', token, identity });
  try {
    expect(await pinned.authenticate()).toEqual(identity);
    expect(calls[0].credential).toBeUndefined();
    expect(calls[1].credential).toBe(`Bearer ${token}`);
    mode = 'changed'; calls = [];
    await expect(pinned.authenticate()).rejects.toThrow('GATEWAY_IDENTITY_CHANGED');
    expect(calls).toHaveLength(1); expect(calls[0].credential).toBeUndefined();
  } finally { pinned.close(); }
});

it('rejects invalid challenges, redirects and throttled authentication', async () => {
  mode = 'nonce'; await expect(upstream.authenticate()).rejects.toThrow('GATEWAY_IDENTITY_PROOF_FAILED');
  mode = 'redirect'; await expect(upstream.authenticate()).rejects.toThrow('GATEWAY_CONTRACT_UNAVAILABLE');
  mode = 'throttle'; await expect(upstream.authenticate()).rejects.toMatchObject({ retryAfterSeconds: 2 });
});
