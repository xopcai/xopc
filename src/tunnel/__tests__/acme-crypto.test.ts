import { describe, expect, it } from 'vitest';

import {
  base64url,
  ensureEcAccountKeyPem,
  exportJwkFromPrivateKeyPem,
  jwkThumbprint,
  signAcmeJws,
} from '../acme-crypto.js';

describe('acme-crypto', () => {
  it('base64url encodes buffers', () => {
    expect(base64url(Buffer.from('hello'))).toBe('aGVsbG8');
  });

  it('signAcmeJws embeds jwk for new-account requests (no kid)', () => {
    const realKey = ensureEcAccountKeyPem();
    const jwk = exportJwkFromPrivateKeyPem(realKey);
    const jws = signAcmeJws({
      privateKeyPem: realKey,
      url: 'https://acme-staging-v02.api.letsencrypt.org/acme/new-acct',
      nonce: 'nonce123',
      payload: { termsOfServiceAgreed: true },
      jwk,
    });
    const header = JSON.parse(Buffer.from(jws.protected, 'base64url').toString('utf8')) as {
      jwk?: unknown;
      kid?: string;
    };
    expect(header.jwk).toEqual(jwk);
    expect(header.kid).toBeUndefined();
  });

  it('signAcmeJws uses empty payload for POST-as-GET (null)', () => {
    const realKey = ensureEcAccountKeyPem();
    const jwk = exportJwkFromPrivateKeyPem(realKey);
    const jws = signAcmeJws({
      privateKeyPem: realKey,
      url: 'https://acme.example/order/1',
      nonce: 'nonce123',
      payload: null,
      kid: 'https://acme.example/acct/1',
    });
    expect(jws.payload).toBe('');
    expect(jws.protected).toBeTruthy();
    expect(jws.signature).toBeTruthy();
    expect(jwkThumbprint(jwk)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
