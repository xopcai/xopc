import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDevicePairingProof } from '@xopcai/gateway-contract';

const state = vi.hoisted(() => ({ journal: new Map<string, unknown>(), saved: vi.fn(), refresh: vi.fn(), token: '' }));
vi.mock('expo-device', () => ({ modelName: 'iPhone' }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ savePairedProfile: state.saved }) } }));
vi.mock('../../../storage/device-credentials', () => ({
  getOrCreateDevicePrivateKey: () => new Uint8Array(32).fill(1),
  writeDeviceRefreshToken: (_id: string, token: string) => { state.token = token; },
  readDeviceAuthJournal: (id: string) => state.journal.get(id),
  writeDeviceAuthJournal: (id: string, value: unknown) => state.journal.set(id, structuredClone(value)),
  clearDeviceAuthJournal: (id: string) => state.journal.delete(id),
}));
vi.mock('../device-auth-session', () => ({
  createDeviceRefreshToken: () => 'initial-refresh', refreshCredentialsForProfile: state.refresh,
}));
import { pairWithGateway, readPendingDevicePairing, useDevicePairingFlow } from '../pair-gateway';
import type { ParsedGatewayQr } from '../parse-gateway-qr';

const keys = crypto.generateKeyPairSync('ed25519');
// Use the same AbortController as React Native; Node's signal has extra methods.
const requireReactNative = createRequire(import.meta.resolve('react-native/package.json'));
const { AbortController: NativeAbortController } = requireReactNative('abort-controller/dist/abort-controller');
const gatewayPublicKey = keys.publicKey.export({ format: 'jwk' }).x!;
const pairing: ParsedGatewayQr = { version: 3, gatewayId: 'computer-a', gatewayName: 'Work Mac', gatewayPublicKey,
  pairingToken: 'xopc_pair_123_secret', expiresAt: Date.now() + 600000,
  routes: [{ id: 'r', kind: 'custom-https', url: 'https://computer.example' }] };
function response(payload: unknown, tamper = false) {
  const signedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(signedPayload), keys.privateKey).toString('base64url');
  return new Response(JSON.stringify({ signedPayload: tamper ? signedPayload + 'A' : signedPayload, signature }));
}
describe('mobile approved pairing', () => {
  beforeEach(() => { state.journal.clear(); state.saved.mockReset(); state.refresh.mockReset(); state.refresh.mockResolvedValue({ accessToken: 'access', accessTokenExpiresAt: Date.now() + 60000 }); vi.useFakeTimers(); vi.stubGlobal('AbortController', NativeAbortController); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('proves device possession, waits for approval, then commits credentials once', async () => {
    const actions: string[] = [];
    let publicKey: { kty: string; crv: string; x: string; y: string };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const action = url.endsWith('/requests') ? 'request' : url.split('/').pop()!;
      actions.push(action);
      if (action === 'probe') return response({ gatewayId: pairing.gatewayId, pairingId: '123', issuedAt: Date.now() });
      if (body.device) publicKey = body.device.publicKeyJwk;
      expect(crypto.verify('sha256', Buffer.from(buildDevicePairingProof(action as 'request', body)), {
        key: crypto.createPublicKey({ key: publicKey!, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
      }, Buffer.from(body.signature, 'base64url'))).toBe(true);
      return response({ gateway: { id: pairing.gatewayId, name: pairing.gatewayName }, nonce: body.nonce,
        request: { requestId: body.requestId, status: action === 'request' ? 'pending' : action === 'status' ? 'approved' : 'completed', confirmationCode: '123456', deviceId: 'phone', expiresAt: pairing.expiresAt },
        routes: pairing.routes, scopes: ['sessions.read', 'sessions.write'] });
    }));
    const result = pairWithGateway(pairing);
    await vi.advanceTimersByTimeAsync(0);
    expect(useDevicePairingFlow.getState().progress?.stage).toBe('approval');
    expect(state.saved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect((await result).deviceId).toBe('phone');
    expect(actions).toEqual(['probe', 'request', 'status', 'complete']);
    expect(state.saved).toHaveBeenCalledOnce();
    expect(readPendingDevicePairing()).toBeNull();
  });
  it('rejects an identity mismatch before sending a pairing request', async () => {
    const fetch = vi.fn(async () => response({ gatewayId: pairing.gatewayId, pairingId: '123', issuedAt: Date.now() }, true));
    vi.stubGlobal('fetch', fetch);
    await expect(pairWithGateway(pairing)).rejects.toThrow('PAIRING_IDENTITY_MISMATCH');
    expect(fetch).toHaveBeenCalledOnce();
    expect(state.saved).not.toHaveBeenCalled();
  });
  it('does not start a network request when already paused', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(pairWithGateway(pairing, controller.signal)).rejects.toThrow('PAIRING_PAUSED');
    expect(fetch).not.toHaveBeenCalled();
    expect(useDevicePairingFlow.getState().error).toBeNull();
  });
  it('stops probing routes when paused without reporting a connection failure', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      throw new Error('Aborted');
    });
    vi.stubGlobal('fetch', fetch);
    const qr = { ...pairing, routes: [...pairing.routes, { id: 'fallback', kind: 'xopc-secure-link' as const, url: 'https://fallback.example' }] };
    await expect(pairWithGateway(qr, controller.signal)).rejects.toThrow('PAIRING_PAUSED');
    expect(fetch).toHaveBeenCalledOnce();
    expect(readPendingDevicePairing()).toBeNull();
    expect(useDevicePairingFlow.getState().error).toBeNull();
  });
  it('tries the next secure route after a pairing request connection failure', async () => {
    const qr = { ...pairing, routes: [...pairing.routes, { id: 'fallback', kind: 'xopc-secure-link' as const, url: 'https://fallback.example' }] };
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.endsWith('/probe')) return response({ gatewayId: qr.gatewayId, pairingId: '123', issuedAt: Date.now() });
      if (url.startsWith(qr.routes[0]!.url)) throw new Error('Network request failed');
      return response({ gateway: { id: qr.gatewayId, name: qr.gatewayName }, nonce: body.nonce,
        request: { requestId: body.requestId, status: 'completed', deviceId: 'phone' }, routes: qr.routes, scopes: ['sessions.read'] });
    });
    vi.stubGlobal('fetch', fetch);
    const profile = await pairWithGateway(qr);
    expect(profile.activeRouteId).toBe('fallback');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${qr.routes[0]!.url}/api/device-pairing/probe`,
      `${qr.routes[0]!.url}/api/device-pairing/requests`,
      'https://fallback.example/api/device-pairing/requests',
      expect.stringMatching(/^https:\/\/fallback\.example\/api\/device-pairing\/requests\/[^/]+\/complete$/),
    ]);
    expect(state.saved).toHaveBeenCalledOnce();
  });
  it('recovers completion after a failed refresh without repeating completion or replacing its token', async () => {
    const actions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const action = url.endsWith('/requests') ? 'request' : url.split('/').pop()!; actions.push(action);
      if (action === 'probe') return response({ gatewayId: pairing.gatewayId, pairingId: '123', issuedAt: Date.now() });
      return response({ gateway: { id: pairing.gatewayId, name: pairing.gatewayName }, nonce: body.nonce,
        request: { requestId: body.requestId, status: 'completed', deviceId: 'phone' }, routes: pairing.routes, scopes: ['sessions.read'] });
    }));
    state.refresh.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(pairWithGateway(pairing)).rejects.toThrow('Network request failed');
    expect(readPendingDevicePairing()).toEqual(pairing);
    state.token = 'rotated-after-lost-response';
    await pairWithGateway(pairing);
    expect(actions).toEqual(['probe', 'request', 'complete']);
    expect(state.token).toBe('rotated-after-lost-response');
    expect(state.saved).toHaveBeenCalledOnce();
  });
});
