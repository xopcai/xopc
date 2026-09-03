import { buildDevicePairingProof } from '@xopcai/gateway-contract';
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

describe('device pairing routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
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
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates a Universal Link and exchanges it for per-device credentials', async () => {
    const readinessResponse = await app.request('/api/device-pairing/readiness');
    expect(await readinessResponse.json()).toMatchObject({
      ok: true,
      ready: true,
      routes: [expect.objectContaining({ url: 'https://gateway.example.com' })],
    });

    const setupResponse = await app.request('/api/device-pairing/setups', { method: 'POST' });
    expect(setupResponse.status).toBe(201);
    const setupBody = await setupResponse.json() as {
      setup: { universalLink: string; routes: Array<{ url: string }> };
    };
    const encoded = new URL(setupBody.setup.universalLink).hash.slice('#p='.length);
    const pairing = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
      pairingToken: string;
      gatewayId: string;
      gatewayPublicKey: string;
    };
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

    const deviceKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const exchangeResponse = await app.request('/api/device-pairing/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingToken: pairing.pairingToken,
        device: {
          displayName: 'My iPhone',
          platform: 'ios',
          publicKeyJwk: deviceKeys.publicKey.export({ format: 'jwk' }),
        },
      }),
    });
    expect(exchangeResponse.status).toBe(201);
    const exchange = await exchangeResponse.json() as { signedPayload: string; signature: string };
    expect(crypto.verify(
      null,
      Buffer.from(exchange.signedPayload),
      crypto.createPublicKey({
        format: 'jwk',
        key: { kty: 'OKP', crv: 'Ed25519', x: pairing.gatewayPublicKey },
      }),
      Buffer.from(exchange.signature, 'base64url'),
    )).toBe(true);
    const payload = JSON.parse(Buffer.from(exchange.signedPayload, 'base64url').toString()) as {
      gateway: { id: string };
      device: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };
    expect(payload.gateway.id).toBe(pairing.gatewayId);
    expect(payload.tokens.accessToken).toMatch(/^xopc_at_/);
    expect(payload.tokens.refreshToken).toMatch(/^xopc_rt_/);
    expect(getDevice(payload.device.id)?.displayName).toBe('My iPhone');
  });
  it('requires a desktop decision before issuing a v3 device and signs its status', async () => {
    const setup = await (await app.request('/api/device-pairing/setups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 3 }) })).json();
    const pairing = JSON.parse(Buffer.from(new URL(setup.setup.universalLink).hash.slice(3), 'base64url').toString());
    expect(pairing.version).toBe(3);
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const requestId = crypto.randomUUID();
    async function send(action: 'request' | 'status' | 'complete', extra: Record<string, unknown> = {}) {
      const body = { gatewayId: pairing.gatewayId, pairingToken: pairing.pairingToken, requestId,
        timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), ...extra };
      const signature = crypto.sign('sha256', Buffer.from(buildDevicePairingProof(action, body)), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return app.request(action === 'request' ? '/api/device-pairing/requests' : `/api/device-pairing/requests/${requestId}/${action}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, signature }) });
    }
    const submitted = await (await send('request', { device: { displayName: 'Phone', platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) } })).json();
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
