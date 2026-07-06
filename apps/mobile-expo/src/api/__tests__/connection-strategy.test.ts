import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  probeGatewayRouteReachability,
  raceGatewayRoutes,
  resolvePreferredBaseUrl,
} from '../connection-strategy';

const TEST_TIMING = {
  TIMEOUT_LAN_MS: 50,
  TIMEOUT_TUNNEL_MS: 80,
  LAN_HEAD_START_MS: 30,
  RACE_HARD_TIMEOUT_MS: 200,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeGatewayRouteReachability', () => {
  it('returns reachable with latency when server responds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, body: { cancel: () => {} } })),
    );

    const result = await probeGatewayRouteReachability('192.168.1.44:18790');
    expect(result.reachable).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns timeout reason on abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }),
    );

    const result = await probeGatewayRouteReachability('http://192.168.1.44:18790');
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('timeout');
  });

  it('returns network_error with message when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network request failed');
      }),
    );

    const result = await probeGatewayRouteReachability('http://192.168.1.44:18790');
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('network_error');
    expect(result.errorMessage).toBe('Network request failed');
  });

  it('adds http scheme for private LAN host without scheme', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, body: { cancel: () => {} } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeGatewayRouteReachability('192.168.1.44:18790', { token: 'secret' });
    expect(result.reachable).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.44:18790/health', {
      signal: expect.any(AbortSignal),
      headers: { Authorization: 'Bearer secret' },
    });
  });
});

describe('raceGatewayRoutes', () => {
  beforeEach(() => {
    // Default: every route resolves quickly. Individual tests override.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { cancel: () => {} } })));
  });

  it('returns LAN winner when both routes succeed (LAN preferred)', async () => {
    const result = await raceGatewayRoutes(
      'https://gw.example.com',
      'http://192.168.1.44:18790',
      { timing: TEST_TIMING },
    );
    expect(result.winner).toBe('lan');
    expect(result.url).toBe('http://192.168.1.44:18790');
  });

  it('returns tunnel when LAN fetch fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        call++;
        if (url.includes('192.168')) throw new Error('lan unreachable');
        return { ok: true, body: { cancel: () => {} } };
      }),
    );

    const result = await raceGatewayRoutes(
      'https://gw.example.com',
      'http://192.168.1.44:18790',
      { timing: TEST_TIMING },
    );
    expect(result.winner).toBe('tunnel');
    expect(result.url).toBe('https://gw.example.com');
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("returns 'none' when both routes fail", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );

    const result = await raceGatewayRoutes(
      'https://gw.example.com',
      'http://192.168.1.44:18790',
      { timing: TEST_TIMING },
    );
    expect(result.winner).toBe('none');
    expect(result.url).toBe('');
  });

  it('returns lan immediately when only LAN configured and reachable', async () => {
    const result = await raceGatewayRoutes('', 'http://192.168.1.44:18790', {
      timing: TEST_TIMING,
    });
    expect(result.winner).toBe('lan');
    expect(result.url).toBe('http://192.168.1.44:18790');
  });

  it('returns tunnel when only tunnel configured and reachable', async () => {
    const result = await raceGatewayRoutes('https://gw.example.com', undefined, {
      timing: TEST_TIMING,
    });
    expect(result.winner).toBe('tunnel');
    expect(result.url).toBe('https://gw.example.com');
  });
});

describe('resolvePreferredBaseUrl', () => {
  it('returns tunnel when only tunnel configured and reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { cancel: () => {} } })));
    await expect(
      resolvePreferredBaseUrl('https://gw.frp.example.com/', undefined, { timing: TEST_TIMING }),
    ).resolves.toBe('https://gw.frp.example.com');
  });

  it('returns LAN when tunnel URL is empty but LAN is configured and reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { cancel: () => {} } })));

    await expect(
      resolvePreferredBaseUrl('', 'http://192.168.1.44:18790', {
        token: 'secret',
        timing: TEST_TIMING,
      }),
    ).resolves.toBe('http://192.168.1.44:18790');
  });

  it('prefers LAN when both succeed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { cancel: () => {} } })));

    await expect(
      resolvePreferredBaseUrl('https://gw.frp.example.com', 'http://192.168.1.44:18790', {
        token: 'secret',
        timing: TEST_TIMING,
      }),
    ).resolves.toBe('http://192.168.1.44:18790');
  });

  it('falls back to tunnel when LAN throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('192.168')) throw new Error('lan dead');
        return { ok: true, body: { cancel: () => {} } };
      }),
    );

    await expect(
      resolvePreferredBaseUrl('https://gw.frp.example.com', 'http://192.168.1.44:18790', {
        timing: TEST_TIMING,
      }),
    ).resolves.toBe('https://gw.frp.example.com');
  });
});
