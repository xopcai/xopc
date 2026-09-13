import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureGatewayRouteIdentity, clearGatewayRouteIdentityCache } from '../route-identity';
import type { GatewayProfile } from '../../../stores/gateway-types';

const keys = generateKeyPairSync('ed25519');
const profile = { gatewayId: 'computer', gatewayPublicKey: keys.publicKey.export({ format: 'jwk' }).x } as GatewayProfile;
function response(nonce: string, overrides: Record<string, unknown> = {}, signer = keys.privateKey) {
  const signedPayload = Buffer.from(JSON.stringify({ purpose: 'gateway-route-v1', gatewayId: profile.gatewayId,
    nonce, expiresAt: Date.now() + 30_000, ...overrides })).toString('base64url');
  return Response.json({ signedPayload, signature: sign(null, Buffer.from(signedPayload), signer).toString('base64url') });
}
describe('continuous Gateway identity verification', () => {
  beforeEach(clearGatewayRouteIdentityCache);
  afterEach(() => vi.unstubAllGlobals());
  it('checks the pinned identity and coalesces warm probes', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => response(JSON.parse(String(init.body)).nonce));
    vi.stubGlobal('fetch', fetch);
    await Promise.all([ensureGatewayRouteIdentity(profile, 'https://computer.example'), ensureGatewayRouteIdentity(profile, 'https://computer.example')]);
    await ensureGatewayRouteIdentity(profile, 'https://computer.example');
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0][1].headers).has('Authorization')).toBe(false);
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
  });
  it.each([{ nonce: 'replayed' }, { gatewayId: 'other' }, { expiresAt: 1 }, { purpose: 'pairing' }])('rejects an unrelated signed response %j', async (overrides) => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => response(JSON.parse(String(init.body)).nonce, overrides)));
    await expect(ensureGatewayRouteIdentity(profile, 'https://computer.example')).rejects.toThrow('GATEWAY_IDENTITY_MISMATCH');
  });
  it('rejects a replacement signing key and plaintext routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => response(JSON.parse(String(init.body)).nonce, {}, generateKeyPairSync('ed25519').privateKey)));
    await expect(ensureGatewayRouteIdentity(profile, 'https://computer.example')).rejects.toThrow('GATEWAY_IDENTITY_MISMATCH');
    await expect(ensureGatewayRouteIdentity(profile, 'http://computer.example')).rejects.toThrow('GATEWAY_IDENTITY_MISMATCH');
  });
});
