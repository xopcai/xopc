import crypto from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { createDevice, issueDeviceTokenPair, rotateDeviceRefreshToken, buildRefreshProofMessage, getDevice, authenticateDeviceAccessToken } from '../../../storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { auth } from '../../hono/middleware/auth.js';
import { consumeRequestNonce, parseRequestProof, proofDigest, requestProofMessage, verifyDeviceConnectionProof } from '../device-request-proof.js';

const ownerToken = 'test-owner-token';
describe('device request proofs through HTTP authentication', () => {
  let dir: string;
  let deviceId: string;
  let token: string;
  let key: crypto.KeyObject;
  let gatewayId: string;
  let app: Hono;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-request-proof-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'test.db') });
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); key = keys.privateKey;
    deviceId = createDevice({ displayName: 'Phone', platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }), scopes: ['sessions.write'] }).id;
    token = issueDeviceTokenPair(deviceId).accessToken;
    gatewayId = getOrCreateGatewayIdentity().id;
    app = new Hono(); app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: ownerToken }) }));
    app.post('/api/test', async c => c.json(await c.req.json()));
    app.get('/api/test', c => c.json({ ok: true }));
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  function enable() { getSqliteDatabase().prepare('UPDATE devices SET request_proof_version = 1 WHERE device_id = ?').run(deviceId); }
  function sign(body = '{"text":"你好"}', overrides: Partial<{ credential: string; method: string; target: string; timestamp: number; nonce: string; gatewayId: string; idempotencyKey: string; contentType: string }> = {}) {
    const proof = { timestamp: overrides.timestamp ?? Date.now(), nonce: overrides.nonce ?? crypto.randomBytes(24).toString('base64url'), digest: proofDigest(body) };
    const message = requestProofMessage({ gatewayId: overrides.gatewayId ?? gatewayId, credential: overrides.credential ?? token,
      method: overrides.method ?? 'POST', target: overrides.target ?? '/api/test?a=1&a=2',
      headers: name => name === 'content-type' ? (overrides.contentType ?? 'application/json') : name === 'idempotency-key' ? overrides.idempotencyKey : undefined, proof });
    return `${proof.timestamp}.${proof.nonce}.${proof.digest}.${crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  function request(proof?: string, body = '{"text":"你好"}', credential = token) {
    return app.request('/api/test?a=1&a=2', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...(proof ? { 'X-Xopc-Proof': proof } : {}) }, body });
  }

  it('matches the published cross-platform verification vector', () => {
    const vector = JSON.parse(readFileSync(new URL('../../../../packages/gateway-contract/test-fixtures/device-request-proof-v1.json', import.meta.url), 'utf8'));
    const input = vector.input;
    const message = requestProofMessage({ ...input, headers: name => ['content-type', 'idempotency-key', 'x-xopc-expected-session-key', 'x-endpoint-id', 'x-endpoint-upload-token'].map((name, index) => [name, input.headers[index]]).find(([entry]) => entry === name)?.[1],
      proof: { timestamp: input.timestamp, nonce: input.nonce, digest: proofDigest(input.body) } });
    expect(message).toBe(vector.message);
    expect(crypto.verify('sha256', Buffer.from(message), { key: crypto.createPublicKey({ key: vector.publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(vector.signature, 'base64'))).toBe(true);
  });
  it('verifies actual multipart bytes before the route parses the attachment', async () => {
    enable();
    app.post('/api/upload', async c => { const form = await c.req.formData(); const file = form.get('file') as File; return c.json({ name: file.name, text: await file.text() }); });
    const form = new FormData(); form.append('file', new Blob(['hello 你好']), 'test.txt');
    const encoded = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const body = await encoded.text(); const contentType = encoded.headers.get('content-type')!;
    const response = await app.request('/api/upload', { method: 'POST', body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'X-Xopc-Proof': sign(body, { target: '/api/upload', contentType }) } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ name: 'test.txt', text: 'hello 你好' });
  });

  it('keeps legacy devices and owner credentials working, but fails closed after upgrade', async () => {
    expect((await request()).status).toBe(200); enable();
    expect((await request()).status).toBe(401);
    expect((await request(undefined, '{}', ownerToken)).status).toBe(200);
    expect((await request('invalid')).status).toBe(401);
  });
  it('authenticates actual bytes without consuming the route body', async () => {
    enable(); const response = await request(sign()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '你好' });
  });
  it('rejects body, token, query, audience, header and timestamp substitution', async () => {
    enable();
    for (const proof of [sign('', {}), sign(undefined, { credential: ownerToken }), sign(undefined, { target: '/api/test?a=2&a=1' }),
      sign(undefined, { gatewayId: crypto.randomUUID() }), sign(undefined, { idempotencyKey: crypto.randomUUID() }), sign(undefined, { timestamp: Date.now() - 120001 })]) {
      expect((await request(proof)).status).toBe(401);
    }
    expect((await request(sign(), '{"text":"tampered"}')).status).toBe(401);
  });
  it('rejects replay after database reopen and permits a fresh signed retry', async () => {
    enable(); const proof = sign(); expect((await request(proof)).status).toBe(200);
    closeXopcDatabase(); openXopcDatabase({ path: join(dir, 'test.db') });
    expect((await request(proof)).status).toBe(401); expect((await request(sign())).status).toBe(200);
  });
  it('retains future-dated nonces through their full acceptance window', () => {
    const now = Date.now(); const proof = parseRequestProof(sign(undefined, { timestamp: now + 119000 }))!;
    expect(consumeRequestNonce(deviceId, proof, now)).toBe(true);
    expect(consumeRequestNonce(deviceId, proof, now + 121000)).toBe(false);
  });
  it('requires a private-key proof for a connection ticket and prevents connection replay', () => {
    enable(); const ticket = crypto.randomBytes(32).toString('base64url');
    const proof = { timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), digest: proofDigest('') };
    const message = requestProofMessage({ gatewayId, credential: ticket, method: 'CONNECT', target: '/api/realtime/v1/ws', headers: () => undefined, proof });
    const header = `${proof.timestamp}.${proof.nonce}.${proof.digest}.${crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    expect(verifyDeviceConnectionProof(deviceId, ticket, '/api/realtime/v1/ws', undefined)).toBe(false);
    expect(verifyDeviceConnectionProof(deviceId, ticket + 'x', '/api/realtime/v1/ws', header)).toBe(false);
    expect(verifyDeviceConnectionProof(deviceId, ticket, '/api/realtime/v1/ws', header)).toBe(true);
    expect(verifyDeviceConnectionProof(deviceId, ticket, '/api/realtime/v1/ws', header)).toBe(false);
  });
  it('binds the voice proxy query and rejects revoked device connections', () => {
    enable(); const ticket = crypto.randomBytes(32).toString('base64url');
    const target = '/api/realtime/v1/ws?transport=voice-v3';
    const proof = { timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), digest: proofDigest('') };
    const message = requestProofMessage({ gatewayId, credential: ticket, method: 'CONNECT', target, headers: () => undefined, proof });
    const header = `${proof.timestamp}.${proof.nonce}.${proof.digest}.${crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    expect(verifyDeviceConnectionProof(deviceId, ticket, '/api/realtime/v1/ws', header)).toBe(false);
    getSqliteDatabase().prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(Date.now(), deviceId);
    expect(verifyDeviceConnectionProof(deviceId, ticket, target, header)).toBe(false);
  });
  it('atomically enables proofs, revokes old tokens and rejects signed downgrade', () => {
    const initial = issueDeviceTokenPair(deviceId);
    const input = { refreshToken: initial.refreshToken, nextRefreshToken: `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}`,
      requestId: crypto.randomUUID(), timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), requestProofVersion: 1 };
    const message = buildRefreshProofMessage({ ...input, credentialId: input.refreshToken.slice(8).split('_')[0] });
    const signature = crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const next = rotateDeviceRefreshToken({ ...input, signature });
    expect(getDevice(deviceId)?.requestProofVersion).toBe(1);
    expect(authenticateDeviceAccessToken(token)).toBeUndefined();
    expect(authenticateDeviceAccessToken(next.accessToken)).toBeDefined();
    expect(() => rotateDeviceRefreshToken({ ...input, requestProofVersion: undefined, signature })).toThrow();
    expect(rotateDeviceRefreshToken({ ...input, signature }).refreshToken).toBe(next.refreshToken);
  });
  it('accepts exactly one concurrent replay over a real HTTP listener', async () => {
    enable(); const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    try {
      const proof = sign();
      const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`http://127.0.0.1:${address.port}/api/test?a=1&a=2`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Xopc-Proof': proof }, body: '{"text":"你好"}' })));
      expect(responses.filter(response => response.status === 200)).toHaveLength(1);
      expect(responses.filter(response => response.status === 401)).toHaveLength(7);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
