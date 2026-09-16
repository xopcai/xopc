import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDeviceAuthPublicRoutes, registerDeviceRoutes } from '../../../src/gateway/hono/routes/devices';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest, getDevice } from '../../../src/storage/sqlite';
import { buckets } from '../../../src/gateway/rate-limit';
import type { AuthenticatedRouteDeps } from '../../../src/gateway/hono/routes/deps';

const mocks = vi.hoisted(() => ({
  records: new Map<string, string>(),
  keys: new Map<string, unknown>(),
  request: vi.fn(),
}));

vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({
  utf8: (text: string) => new TextEncoder().encode(text),
  fromUtf8: (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  XopcSecureStore: class {
    async read(key: string) { return mocks.records.get(key); }
    async write(key: string, value: string) { mocks.records.set(key, value); }
    async remove(key: string) { mocks.records.delete(key); }
  },
}));

vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({
  XopcDeviceCrypto: class {
    keys: ReturnType<typeof crypto.generateKeyPairSync>;
    constructor() {
      this.keys = (mocks.keys.get('device') ?? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })) as ReturnType<typeof crypto.generateKeyPairSync>;
      mocks.keys.set('device', this.keys);
    }
    async publicKey() { return this.keys.publicKey.export({ format: 'jwk' }); }
    async clearKey() { mocks.keys.delete('device'); }
    async sign(message: string) { return crypto.sign('sha256', Buffer.from(message), { key: this.keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'); }
    async verify(key: string, envelope: { signedPayload: string; signature: string }) {
      const valid = crypto.verify(null, Buffer.from(envelope.signedPayload), crypto.createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: key } }), Buffer.from(envelope.signature, 'base64url'));
      if (!valid) throw new Error('GATEWAY_IDENTITY_MISMATCH');
      return Buffer.from(envelope.signedPayload, 'base64url').toString();
    }
    async nonce(length = 24) { return crypto.randomBytes(length).toString('base64url'); }
    uuid() { return crypto.randomUUID(); }
    async refreshToken() { return `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}`; }
  },
}));

vi.mock('../entry/src/main/ets/service/transport.ets', () => ({
  XopcHttpError: class extends Error { constructor(public status: number) { super(`HTTP_${status}`); } },
  XopcTransport: class { request(...args: unknown[]) { return mocks.request(...args); } },
}));

import { XopcGatewaySession } from '../entry/src/main/ets/service/gatewaySession.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';

describe('native session against real Gateway pairing/auth routes', () => {
  let app: Hono;
  let stateDir: string;
  let approve: boolean;
  let loseRefreshResponse: boolean;
  let loseCompleteResponse: boolean;
  let session: XopcGatewaySession;

  beforeEach(() => {
    process.env.XOPC_LOG_LEVEL = 'fatal';
    mocks.records.clear(); mocks.keys.clear(); mocks.request.mockReset(); buckets.resetAllForTests();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-harmony-auth-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono(); approve = true; loseRefreshResponse = false; loseCompleteResponse = false;
    registerDeviceAuthPublicRoutes(app);
    registerDeviceRoutes(app, {
      service: { currentConfig: { gateway: { publicUrl: 'https://gateway.example.com' } }, realtime: { disconnectPrincipal() {} } },
    } as unknown as AuthenticatedRouteDeps);
    mocks.request.mockImplementation(async (_origin, path, method = 'GET', body = '') => {
      const response = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body } : {}) });
      const text = await response.text();
      if (!response.ok) throw new XopcHttpError(response.status);
      if (path === '/api/device-pairing/requests' && approve) {
        const pending = JSON.parse(Buffer.from(JSON.parse(text).signedPayload, 'base64url').toString()).request;
        if (pending.status === 'pending') {
          const decision = await app.request(`/api/device-pairing/requests/${pending.requestId}/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', expectedRevision: pending.revision }),
        });
          expect(decision.status).toBe(200);
        }
      }
      if (path === '/api/device-auth/refresh' && loseRefreshResponse) { loseRefreshResponse = false; throw new Error('CONNECTION_LOST'); }
      if (path.endsWith('/complete') && loseCompleteResponse) { loseCompleteResponse = false; throw new Error('CONNECTION_LOST'); }
      return text;
    });
    session = new XopcGatewaySession();
  });

  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); buckets.resetAllForTests();
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function invitation(): Promise<string> {
    const response = await app.request('/api/device-pairing/setups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'mobile' }),
    });
    return (await response.json()).setup.universalLink;
  }

  it('pairs, verifies signatures, rotates credentials, and coalesces concurrent refresh', async () => {
    const codes: string[] = [];
    const profile = await session.pair(await invitation(), (code: string) => codes.push(code));
    expect(codes).toHaveLength(1);
    expect(getDevice(profile.deviceId)?.platform).toBe('harmonyos');
    expect(mocks.records.has('pairing')).toBe(false);
    expect(mocks.records.has('refresh-attempt')).toBe(false);
    const tokens = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(mocks.request.mock.calls.filter((call) => call[1] === '/api/device-auth/refresh')).toHaveLength(1);
    await session.disconnect();
    expect(mocks.records.has('profile')).toBe(false);
    expect(mocks.keys.has('device')).toBe(false);
    await expect(session.accessToken()).rejects.toThrow('NOT_PAIRED');
  });

  it('recovers a refresh whose server response was lost without rotating twice', async () => {
    loseRefreshResponse = true;
    await expect(session.pair(await invitation(), () => {})).rejects.toThrow('NO_VERIFIED_ROUTE');
    const attempt = JSON.parse(mocks.records.get('refresh-attempt')!);
    const token = await session.accessToken();
    expect(token).toMatch(/^xopc_at_/);
    expect(mocks.records.get('refresh')).toBe(attempt.nextRefreshToken);
    expect(mocks.records.has('refresh-attempt')).toBe(false);
  });
  it('resumes a completed pairing after process restart using the original completion identity', async () => {
    loseCompleteResponse = true;
    await expect(session.pair(await invitation(), () => {})).rejects.toThrow('CONNECTION_LOST');
    const before = JSON.parse(mocks.records.get('pairing')!);
    session = new XopcGatewaySession();
    const profile = await session.restore();
    expect(profile?.deviceId).toBeTruthy(); expect(mocks.records.has('pairing')).toBe(false);
    const completions = mocks.request.mock.calls.filter((call) => call[1].endsWith('/complete')).map((call) => JSON.parse(call[3]));
    expect(completions).toHaveLength(2);
    expect(completions.every((call) => call.idempotencyKey === before.idempotencyKey && call.initialRefreshToken === before.initialRefreshToken)).toBe(true);
  });
});
