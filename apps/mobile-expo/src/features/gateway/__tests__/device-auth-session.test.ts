import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../route-identity', () => ({ ensureGatewayRouteIdentity: vi.fn(async () => {}) }));

const state = vi.hoisted(() => ({ token: 'xopc_rt_old_secret', journal: new Map<string, unknown>(), generation: 1, activeId: 'a', setAccess: vi.fn(), deny: vi.fn() }));
vi.mock('../../../storage/device-credentials', () => ({
  getOrCreateDevicePrivateKey: () => new Uint8Array(32).fill(1),
  readDeviceRefreshToken: () => state.token,
  writeDeviceRefreshToken: (_id: string, token: string) => { state.token = token; },
  readDeviceAuthJournal: (id: string) => state.journal.get(id),
  writeDeviceAuthJournal: (id: string, value: unknown) => state.journal.set(id, structuredClone(value)),
  clearDeviceAuthJournal: (id: string) => state.journal.delete(id),
}));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({
  activeGatewayId: state.activeId, connectionGeneration: state.generation,
  getActiveProfile: () => profile, setAccessToken: state.setAccess, onUnauthorized: state.deny,
}) } }));
import { refreshDeviceAccessToken, resetDeviceAuthSessionForTests } from '../device-auth-session';
const identity = generateKeyPairSync('ed25519');
const profile = { gatewayId: 'a', name: 'Work', deviceId: 'phone', gatewayPublicKey: identity.publicKey.export({ format: 'jwk' }).x!, scopes: [], updatedAt: 1,
  activeRouteId: 'r', routes: [{ id: 'r', kind: 'custom-https', url: 'https://computer.example' }] };
function success(body: { nextRefreshToken: string; nonce: string; requestId: string }) {
  const signedPayload = Buffer.from(JSON.stringify({ purpose: 'device-refresh-v3', gatewayId: profile.gatewayId,
    nonce: body.nonce, requestId: body.requestId, expiresAt: Date.now() + 30_000,
    tokens: { accessToken: 'access', accessTokenExpiresAt: Date.now() + 60000,
      refreshToken: body.nextRefreshToken, refreshTokenExpiresAt: Date.now() + 100000 } })).toString('base64url');
  return Response.json({ signedPayload, signature: sign(null, Buffer.from(signedPayload), identity.privateKey).toString('base64url') });
}
describe('durable device refresh', () => {
  beforeEach(() => { state.token = 'xopc_rt_old_secret'; state.journal.clear(); state.generation = 1; state.activeId = 'a'; state.setAccess.mockReset(); state.deny.mockReset(); resetDeviceAuthSessionForTests(); });
  afterEach(() => vi.unstubAllGlobals());
  it('coalesces refreshes for the same computer', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => success(JSON.parse(String(init.body))));
    vi.stubGlobal('fetch', fetch);
    expect(await Promise.all([refreshDeviceAccessToken(), refreshDeviceAccessToken()])).toEqual(['access', 'access']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(state.journal.size).toBe(0);
  });
  it('retries the persisted rotation after a lost response', async () => {
    const bodies: Array<{ requestId: string; nextRefreshToken: string; nonce: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      if (bodies.length === 1) throw new Error('Network request failed');
      return success(body);
    }));
    await expect(refreshDeviceAccessToken()).rejects.toThrow('No secure gateway route');
    expect(state.deny).not.toHaveBeenCalled();
    expect(state.journal.size).toBe(1);
    resetDeviceAuthSessionForTests();
    await refreshDeviceAccessToken();
    expect(bodies[1].requestId).toBe(bodies[0].requestId);
    expect(bodies[1].nextRefreshToken).toBe(bodies[0].nextRefreshToken);
    expect(bodies[1].nonce).not.toBe(bodies[0].nonce);
  });
  it.each(['nonce', 'signature', 'unsigned'])('rejects a %s response without persisting credentials or clearing the recovery journal', async (fault) => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (fault === 'nonce') return success({ ...body, nonce: 'replayed-nonce' });
      const response = await success(body).json();
      if (fault === 'signature') response.signature = 'invalid';
      else delete response.signature;
      return Response.json(response);
    }));
    await expect(refreshDeviceAccessToken()).rejects.toThrow('No secure gateway route');
    expect(state.token).toBe('xopc_rt_old_secret');
    expect(state.setAccess).not.toHaveBeenCalled();
    expect(state.journal.size).toBe(1);
  });
  it('does not apply late credentials to a new connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      state.generation++; state.activeId = 'b'; return success(JSON.parse(String(init.body)));
    }));
    await expect(refreshDeviceAccessToken()).rejects.toThrow('DEVICE_AUTH_SUPERSEDED');
    expect(state.setAccess).not.toHaveBeenCalled();
    expect(state.deny).not.toHaveBeenCalled();
  });
});
