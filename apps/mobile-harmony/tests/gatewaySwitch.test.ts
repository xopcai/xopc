import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ records: new Map<string, string>(), request: vi.fn(), clearKey: vi.fn() }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({
  utf8: (text: string) => new TextEncoder().encode(text), fromUtf8: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
  XopcSecureStore: class {
    async read(key: string) { return mocks.records.get(key); }
    async write(key: string, value: string) { mocks.records.set(key, value); }
    async remove(key: string) { mocks.records.delete(key); }
  },
}));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {
  async verify(_key: string, envelope: { signedPayload: string }) { return envelope.signedPayload; }
  async sign() { return 'signature'; } async nonce() { return 'nonce'; }
  uuid() { return 'request-id'; } async refreshToken() { return 'next-refresh'; }
  clearKey = mocks.clearKey;
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({
  XopcHttpError: class extends Error { constructor(public status: number) { super(`HTTP_${status}`); } },
  XopcTransport: class { request(...args: unknown[]) { return mocks.request(...args); } },
}));
import { XopcGatewaySession } from '../entry/src/main/ets/service/gatewaySession.ets';
import { gatewayCredentialKey } from '../entry/src/main/ets/service/gatewayProfiles.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';
const profile = (id: string) => ({ gatewayId: id, name: id, gatewayPublicKey: `pin-${id}`, deviceId: `device-${id}`,
  routes: [{ id: 'secure', kind: 'custom-https', url: `https://${id}.example.com` }], activeRouteId: 'secure' });
function response(origin: string, path: string, _method: string, raw: string) {
  const id = origin.includes('//a.') ? 'a' : 'b';
  const body = raw ? JSON.parse(raw) : {};
  if (path === '/api/gateway-identity/challenge') return JSON.stringify({ signedPayload: JSON.stringify({
    purpose: 'gateway-route-v1', gatewayId: id, nonce: body.nonce, expiresAt: Date.now() + 30000,
  }) });
  if (path === '/api/device-auth/refresh') return JSON.stringify({ signedPayload: JSON.stringify({
    purpose: 'device-refresh-v3', gatewayId: id, nonce: body.nonce, requestId: body.requestId, expiresAt: Date.now() + 30000,
    tokens: { accessToken: `token-${id}`, accessTokenExpiresAt: Date.now() + 120000,
      refreshToken: body.nextRefreshToken, refreshTokenExpiresAt: Date.now() + 3600000 },
  }) });
  return JSON.stringify({ gateway: id });
}
describe('multi Gateway session isolation', () => {
  beforeEach(() => {
    mocks.records.clear(); mocks.clearKey.mockReset(); mocks.request.mockReset(); mocks.request.mockImplementation(response);
    mocks.records.set('gateway-catalog', JSON.stringify({ profiles: [profile('a'), profile('b')], activeGatewayId: 'a' }));
    for (const id of ['a', 'b']) mocks.records.set(gatewayCredentialKey(id, 'refresh'), `xopc_rt_${id}_secret`);
  });
  it('switches A/B/A with distinct credentials, verifies before publishing and persists the active selection', async () => {
    const session = new XopcGatewaySession(); await session.restore(); await session.accessToken();
    await session.activate('b'); expect(session.currentProfile()?.gatewayId).toBe('b');
    await session.request('/api/data');
    expect(mocks.request.mock.calls.find(call => call[1] === '/api/data')?.[4]).toBe('token-b');
    const refreshed = mocks.request.mock.calls.filter(call => call[1] === '/api/device-auth/refresh');
    expect(JSON.parse(refreshed[0][3]).refreshToken).toBe('xopc_rt_a_secret');
    expect(JSON.parse(refreshed[1][3]).refreshToken).toBe('xopc_rt_b_secret');
    const restarted = new XopcGatewaySession(); await restarted.restore(); expect(restarted.currentProfile()?.gatewayId).toBe('b');
    await session.activate('a'); expect(session.currentProfile()?.gatewayId).toBe('a'); expect(mocks.clearKey).not.toHaveBeenCalled();
  });
  it('keeps A active when B status verification fails', async () => {
    const session = new XopcGatewaySession(); await session.restore();
    mocks.request.mockImplementation((origin, path, method, raw) => {
      if (origin.includes('//b.') && path === '/api/status') throw new XopcHttpError(503);
      return response(origin, path, method, raw);
    });
    await expect(session.activate('b')).rejects.toThrow('HTTP_503');
    expect(session.currentProfile()?.gatewayId).toBe('a');
    expect(JSON.parse(mocks.records.get('gateway-catalog')!).activeGatewayId).toBe('a');
    expect(await session.request('/api/data')).toContain('"a"');
  });
  it('rejects stale responses and does not replay an old mutation against B', async () => {
    const session = new XopcGatewaySession(); await session.restore(); await session.accessToken();
    let rejectOld!: (error: Error) => void;
    mocks.request.mockImplementation((origin, path, method, raw) => path === '/api/mutate'
      ? new Promise((_resolve, reject) => { rejectOld = reject; }) : response(origin, path, method, raw));
    const pending = session.request('/api/mutate', 'POST', '{}');
    const rejected = expect(pending).rejects.toThrow('OPERATION_CANCELLED');
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf('function'));
    await session.activate('b'); rejectOld(new XopcHttpError(401)); await rejected;
    expect(mocks.request.mock.calls.filter(call => call[1] === '/api/mutate')).toHaveLength(1);
    expect(await session.accessToken()).toBe('token-b');
  });
  it('serializes activation and blocks requests while the candidate is being verified', async () => {
    const session = new XopcGatewaySession(); await session.restore();
    let finish!: () => void;
    mocks.request.mockImplementation((origin, path, method, raw) => path === '/api/status'
      ? new Promise<string>(resolve => { finish = () => resolve('{}'); }) : response(origin, path, method, raw));
    const switching = session.activate('b'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(session.currentProfile()?.gatewayId).toBe('a');
    await expect(session.request('/api/data')).rejects.toThrow('GATEWAY_OPERATION_BUSY');
    await expect(session.activate('a')).rejects.toThrow('GATEWAY_OPERATION_BUSY');
    finish(); await switching; expect(session.currentProfile()?.gatewayId).toBe('b');
  });
  it('removing a profile keeps device keys and the other profile usable', async () => {
    const session = new XopcGatewaySession(); await session.restore();
    await session.removeProfile('a'); expect(session.currentProfile()?.gatewayId).toBe('b');
    expect(await session.accessToken()).toBe('token-b'); expect(mocks.clearKey).not.toHaveBeenCalled();
    expect(mocks.records.has(gatewayCredentialKey('a', 'refresh'))).toBe(false);
  });
  it('cancels a request waiting for old authentication before it can send a mutation', async () => {
    const session = new XopcGatewaySession(); await session.restore();
    let finishRefresh!: () => void;
    mocks.request.mockImplementation((origin, path, method, raw) => {
      if (origin.includes('//a.') && path === '/api/device-auth/refresh') {
        return new Promise<string>(resolve => { finishRefresh = () => resolve(response(origin, path, method, raw)); });
      }
      return response(origin, path, method, raw);
    });
    const mutation = session.request('/api/mutate', 'POST', '{}');
    const rejected = expect(mutation).rejects.toThrow('OPERATION_CANCELLED');
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
    const switching = session.activate('b'); finishRefresh(); await switching; await rejected;
    expect(mocks.request.mock.calls.some(call => call[1] === '/api/mutate')).toBe(false);
    expect(await session.accessToken()).toBe('token-b');
  });
});
