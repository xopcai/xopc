import { buildDevicePairingProof, readMobilePairingInvitation } from '@xopcai/gateway-contract';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { registerDeviceAuthPublicRoutes, registerDeviceRoutes } from '../devices.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { buckets } from '../../../rate-limit/index.js';

describe('device pairing routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    buckets.resetAllForTests();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-device-pairing-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    registerDeviceAuthPublicRoutes(app);
    registerDeviceRoutes(app, {
      service: {
        currentConfig: { gateway: { publicUrl: 'https://gateway.example.com' } },
        realtime: { disconnectPrincipal() {} },
      },
    } as unknown as AuthenticatedRouteDeps);
  });

  afterEach(() => {
    buckets.resetAllForTests();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('rate limits repeated invalid public pairing requests', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await app.request('/api/device-pairing/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      expect(response.status).toBe(400);
    }
    const blocked = await app.request('/api/device-pairing/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('creates a compact mobile Universal Link', async () => {
    const readinessResponse = await app.request('/api/device-pairing/readiness');
    expect(await readinessResponse.json()).toMatchObject({
      ok: true,
      ready: true,
      protocolVersion: 3,
      routes: [expect.objectContaining({ url: 'https://gateway.example.com' })],
    });

    const setupResponse = await app.request('/api/device-pairing/setups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'mobile' }),
    });
    expect(setupResponse.status).toBe(201);
    const setupBody = await setupResponse.json() as {
      setup: { universalLink: string; routes: Array<{ url: string }> };
    };
    const pairing = readMobilePairingInvitation(setupBody.setup.universalLink);
    expect(pairing).toMatchObject({ version: 4, origins: ['https://gateway.example.com'] });
    expect(setupBody.setup.universalLink.length).toBeLessThan(300);
    expect(setupBody.setup.routes).toContainEqual(expect.objectContaining({ url: 'https://gateway.example.com' }));

    const probeResponse = await app.request('/api/device-pairing/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingId: pairing.pairingToken.slice('xopc_pair_'.length).split('_', 1)[0] }),
    });
    const probe = await probeResponse.json() as { signedPayload: string; signature: string };
    expect(crypto.verify(
      null,
      Buffer.from(probe.signedPayload),
      crypto.createPublicKey({
        format: 'jwk',
        key: { kty: 'OKP', crv: 'Ed25519', x: pairing.gatewayPublicKey },
      }),
      Buffer.from(probe.signature, 'base64url'),
    )).toBe(true);

    const missingTarget = await app.request('/api/device-pairing/setups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(missingTarget.status).toBe(400);
  });
  it('creates a non-navigable browser invitation', async () => {
    const response = await app.request('/api/device-pairing/setups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'browser' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { setup: { browserInvitation: string; universalLink?: string } };
    expect(body.setup.browserInvitation).toMatch(/^XOPC-BROWSER-INVITE-V1:[A-Za-z0-9_-]+$/);
    expect(body.setup.universalLink).toBeUndefined();
    const pairing = JSON.parse(Buffer.from(body.setup.browserInvitation.slice('XOPC-BROWSER-INVITE-V1:'.length), 'base64url').toString());
    expect(pairing).toMatchObject({ version: 3, targetKind: 'browser' });
  });
  it.each(['ios', 'android', 'harmonyos'])('requires a desktop decision before issuing a v3 %s device and signs its status', async (platform) => {
    const setup = await (await app.request('/api/device-pairing/setups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'mobile' }) })).json();
    const pairing = readMobilePairingInvitation(setup.setup.universalLink);
    expect(pairing.version).toBe(4);
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const requestId = crypto.randomUUID();
    async function send(action: 'request' | 'status' | 'complete', extra: Record<string, unknown> = {}) {
      const body = { gatewayId: pairing.gatewayId, pairingToken: pairing.pairingToken, requestId,
        timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), ...extra };
      const signature = crypto.sign('sha256', Buffer.from(buildDevicePairingProof(action, body)), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return app.request(action === 'request' ? '/api/device-pairing/requests' : `/api/device-pairing/requests/${requestId}/${action}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, signature }) });
    }
    const submitted = await (await send('request', { device: { displayName: 'Phone', platform, publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) } })).json();
    expect(crypto.verify(null, Buffer.from(submitted.signedPayload), crypto.createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: pairing.gatewayPublicKey } }), Buffer.from(submitted.signature, 'base64url'))).toBe(true);
    const pending = JSON.parse(Buffer.from(submitted.signedPayload, 'base64url').toString()).request;
    const completion = { idempotencyKey: crypto.randomUUID(), initialRefreshToken: `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}` };
    expect((await send('complete', completion)).status).toBe(409);
    const decision = await app.request(`/api/device-pairing/requests/${requestId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', expectedRevision: pending.revision }) });
    expect(decision.status).toBe(200);
    const completed = await (await send('complete', completion)).json();
    const result = JSON.parse(Buffer.from(completed.signedPayload, 'base64url').toString());
    expect(result.request.status).toBe('completed');
    expect(getDevice(result.request.deviceId)?.scopes).not.toContain('gateway.admin');
    expect(result.tokens).toBeUndefined();
  });

});
