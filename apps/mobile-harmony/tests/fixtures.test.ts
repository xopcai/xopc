import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verify, createPublicKey } from 'node:crypto';
import { decodeBase64Url } from '../entry/src/main/ets/common/protocol';

describe('exported cross-platform fixtures', () => {
  it('verifies the portable Ed25519 fixture and Unicode encoding', () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/gateway-contract.json', import.meta.url), 'utf8')).ed25519;
    const key = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: fixture.gatewayPublicKey } });
    expect(verify(null, Buffer.from(fixture.signedPayload), key, Buffer.from(fixture.signature, 'base64url'))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(fixture.signedPayload)))).toEqual({ purpose: 'harmony-conformance', text: '中文 🌟' });
  });
});
