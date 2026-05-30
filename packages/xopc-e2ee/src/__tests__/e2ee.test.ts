import { describe, expect, it } from 'vitest';

import {
  buildDirectionKeys,
  decryptEnvelope,
  deriveDirectionKey,
  deriveRelayStreamKey,
  deriveSessionRootKey,
  encryptEnvelope,
  exportIdentityKeyPair,
  fingerprintPublicKey,
  generateX25519KeyPair,
  hmacSha256,
  loadIdentityKeyPair,
} from '../index.js';

describe('@xopcai/xopc-e2ee', () => {
  it('round-trips envelope encryption between peers', async () => {
    const gateway = await generateX25519KeyPair();
    const device = await generateX25519KeyPair();
    const sessionId = 'sess-test-1';
    const pairingSecret = 'pair-secret';

    const gatewayRoot = await deriveSessionRootKey({
      privateKey: gateway.privateKey,
      peerPublicKey: device.publicKey,
      sessionId,
      pairingSecret,
    });
    const deviceRoot = await deriveSessionRootKey({
      privateKey: device.privateKey,
      peerPublicKey: gateway.publicKey,
      sessionId,
      pairingSecret,
    });

    expect(gatewayRoot).toEqual(deviceRoot);

    const gatewayKeys = await buildDirectionKeys(gatewayRoot);
    const deviceKeys = await buildDirectionKeys(deviceRoot);

    const envelope = await encryptEnvelope(
      deviceKeys.requestKey,
      1,
      JSON.stringify({ hello: 'mobile' }),
      { method: 'POST', path: '/api/agent' },
    );
    const plain = await decryptEnvelope(gatewayKeys.requestKey, envelope);
    expect(JSON.parse(plain)).toEqual({ hello: 'mobile' });

    const confirm = await hmacSha256(gatewayRoot, 'server-confirm');
    expect(confirm.length).toBeGreaterThan(10);
  });

  it('persists identity export/import', async () => {
    const pair = await generateX25519KeyPair();
    const exported = await exportIdentityKeyPair(pair);
    const loaded = await loadIdentityKeyPair(exported);
    expect(fingerprintPublicKey(loaded.publicKey)).toBe(fingerprintPublicKey(pair.publicKey));
  });

  it('derives independent relay-stream keys per request seq', async () => {
    const root = new Uint8Array(32).fill(4);
    const keyA = await deriveRelayStreamKey(root, 1);
    const keyB = await deriveRelayStreamKey(root, 2);
    const legacy = await deriveDirectionKey(root, 'stream');
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(legacy);
  });
});
