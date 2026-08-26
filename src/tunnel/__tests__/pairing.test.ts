import { afterEach, describe, expect, it } from 'vitest';

import {
  cachePairingExchange,
  consumePairingSecret,
  createPairingSecret,
  getPairingSessionId,
  getCachedPairingExchange,
  resetPairingSessionsForTests,
} from '../pairing.js';

describe('tunnel pairing', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
  });

  it('creates a secret valid for 5 minutes', () => {
    const { pairingSessionId, secret, expiresAt } = createPairingSecret();
    expect(pairingSessionId.length).toBeGreaterThan(16);
    expect(getPairingSessionId(secret)).toBe(pairingSessionId);
    expect(secret.length).toBeGreaterThan(20);
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it('consumes a secret once', () => {
    const { secret } = createPairingSecret();
    expect(consumePairingSecret(secret)).toBe(true);
    expect(getPairingSessionId(secret)).toBeNull();
    expect(consumePairingSecret(secret)).toBe(false);
  });

  it('rejects empty secret', () => {
    expect(consumePairingSecret('')).toBe(false);
  });

  it('caches exchange payload for replay after consume', () => {
    const { secret } = createPairingSecret();
    expect(consumePairingSecret(secret)).toBe(true);
    expect(getCachedPairingExchange(secret)).toBeNull();

    const payload = {
      token: 'tok',
      baseUrl: 'https://abc.frp.xopc.ai',
      lanUrl: 'http://192.168.1.2:18789',
      connectUrls: ['https://abc.frp.xopc.ai', 'http://192.168.1.2:18789'],
    };
    cachePairingExchange(secret, payload);
    expect(getCachedPairingExchange(secret)).toEqual(payload);
    expect(consumePairingSecret(secret)).toBe(false);
    expect(getCachedPairingExchange(secret)).toEqual(payload);
  });
});
