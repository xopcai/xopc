import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createBrowserRequestProof } from '../../../packages/browser-ext/src/sidepanel/auth.js';

let deviceKeys: CryptoKeyPair;
beforeEach(async () => {
  deviceKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  vi.stubGlobal('indexedDB', { open: () => {
    const opening: Record<string, unknown> = {};
    queueMicrotask(() => {
      opening.result = { close() {}, transaction: () => ({ objectStore: () => ({ get: () => {
        const reading: Record<string, unknown> = {};
        queueMicrotask(() => { reading.result = deviceKeys; (reading.onsuccess as () => void)(); });
        return reading;
      } }) }) };
      (opening.onsuccess as () => void)();
    });
    return opening;
  } });
});
afterEach(() => vi.unstubAllGlobals());

it('signs HTTP and browser Realtime proofs using the Gateway canonical contract', async () => {
  const { parseRequestProof, requestProofMessage } = await import('../../gateway/security/device-request-proof.js');
  const profile = { gatewayId: 'gateway', deviceId: 'device', gatewayPublicKey: 'key' };
  for (const method of ['POST', 'CONNECT']) {
    const outgoing = new Request('https://gateway.example/api/realtime/v1/ws?a=1', method === 'POST'
      ? { method, headers: { 'Content-Type': 'application/json' }, body: '{"test":true}' } : {});
    const header = await createBrowserRequestProof(profile, outgoing, 'credential', method);
    const proof = parseRequestProof(header)!;
    expect(proof).toBeDefined();
    const message = requestProofMessage({ gatewayId: profile.gatewayId, credential: 'credential', method,
      target: '/api/realtime/v1/ws?a=1', headers: name => outgoing.headers.get(name) ?? undefined, proof });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, deviceKeys.publicKey,
      Buffer.from(proof.signature, 'base64url'), new TextEncoder().encode(message))).toBe(true);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, deviceKeys.publicKey,
      Buffer.from(proof.signature, 'base64url'), new TextEncoder().encode(message + 'tampered'))).toBe(false);
  }
});

it('refreshes credentials with versioned proof and verifies the signed response', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { buildRefreshProofMessage } = await import('../../storage/sqlite/device-access-repository.js');
  const { getAccessProfile } = await import('../../../packages/browser-ext/src/sidepanel/auth.js');
  const gateway = generateKeyPairSync('ed25519');
  const profile = { gatewayId: 'gateway', gatewayName: 'Test', gatewayUrl: 'https://gateway.example',
    gatewayPublicKey: gateway.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url'),
    deviceId: 'device', refreshToken: `xopc_rt_${crypto.randomUUID()}_${'a'.repeat(43)}`,
    accessToken: 'expired', accessTokenExpiresAt: 1 };
  const values: Record<string, unknown> = { 'xopc.browser.profile': profile };
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => values),
    set: vi.fn(async update => Object.assign(values, update)),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  } } });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    expect(body.requestProofVersion).toBe(1);
    const message = buildRefreshProofMessage({ ...body, credentialId: profile.refreshToken.slice(8).split('_')[0] });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, deviceKeys.publicKey,
      Buffer.from(body.signature, 'base64url'), new TextEncoder().encode(message))).toBe(true);
    const signedPayload = Buffer.from(JSON.stringify({ purpose: 'device-refresh-v3', gatewayId: profile.gatewayId,
      requestId: body.requestId, nonce: body.nonce, expiresAt: Date.now() + 30000, requestProofVersion: 1,
      tokens: { accessToken: 'fresh', accessTokenExpiresAt: Date.now() + 120000, refreshToken: body.nextRefreshToken },
    })).toString('base64url');
    return Response.json({ signedPayload, signature: sign(null, Buffer.from(signedPayload), gateway.privateKey).toString('base64url') });
  }));
  expect((await getAccessProfile()).accessToken).toBe('fresh');
});
