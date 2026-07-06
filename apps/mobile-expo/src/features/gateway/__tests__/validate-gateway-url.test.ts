import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMobilePairPing, validateMobilePairBaseUrlPublic } from '../../../api/mobile-pair';
import {
  assertNotLoopbackGatewayUrl,
  validateGatewayUrlForManualConnect,
} from '../validate-gateway-url';

describe('assertNotLoopbackGatewayUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks localhost manual config outside dev builds', () => {
    const result = assertNotLoopbackGatewayUrl('http://127.0.0.1:28790');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('LOOPBACK_NOT_REACHABLE');
    }
  });

  it('allows localhost manual config in dev builds', () => {
    vi.stubGlobal('__DEV__', true);

    const result = assertNotLoopbackGatewayUrl('http://127.0.0.1:28790');

    expect(result).toBeNull();
  });
});

describe('validateGatewayUrlForManualConnect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses pair/ping when gateway responds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          mobilePairing: true,
          connectUrls: ['http://192.168.1.5:28790'],
        }),
      ),
    );

    const result = await validateGatewayUrlForManualConnect('http://192.168.1.5:28790');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.connectUrls).toEqual(['http://192.168.1.5:28790']);
    }
  });
});

describe('mobile-pair api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchMobilePairPing hits public probe path', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, mobilePairing: true, pairingReady: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMobilePairPing('http://192.168.1.5:28790');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.5:28790/api/tunnel/pair/ping',
      expect.any(Object),
    );
    expect(result.mobilePairing).toBe(true);
  });

  it('validateMobilePairBaseUrlPublic rejects loopback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: false,
          code: 'LOOPBACK_NOT_REACHABLE',
          message: 'loopback',
        }),
      ),
    );

    const result = await validateMobilePairBaseUrlPublic('http://127.0.0.1:28790');
    expect(result.ok).toBe(false);
  });
});
