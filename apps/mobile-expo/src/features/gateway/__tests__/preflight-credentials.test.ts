import { beforeEach, describe, expect, it, vi } from 'vitest';

const raceGatewayRoutes = vi.hoisted(() => vi.fn());

vi.mock('../../../api/connection-strategy', () => ({
  raceGatewayRoutes,
}));

vi.mock('../network-info', () => ({
  getNetworkSnapshot: () => ({ key: 'wifi:test', kind: 'wifi' }),
}));

vi.mock('../connection-log', () => ({
  recordConnectionEvent: vi.fn(),
}));

import { preflightGatewayCredentials } from '../preflight-credentials';

beforeEach(() => {
  raceGatewayRoutes.mockReset();
});

describe('preflightGatewayCredentials', () => {
  it('rejects a reachable gateway when its token is invalid', async () => {
    raceGatewayRoutes.mockResolvedValue({
      winner: 'none',
      url: '',
      lan: null,
      tunnel: { reachable: false, reason: 'http_error', httpStatus: 401 },
    });

    const result = await preflightGatewayCredentials({
      baseUrl: 'https://gateway.example.com',
      lanUrl: null,
      token: 'expired',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('token-invalid');
      expect(result.error.httpStatus).toBe(401);
    }
  });

  it('returns the winning route without mutating gateway state', async () => {
    raceGatewayRoutes.mockResolvedValue({
      winner: 'lan',
      url: 'http://192.168.1.20:18790',
      latencyMs: 24,
      lan: { reachable: true, latencyMs: 24 },
      tunnel: null,
    });

    await expect(preflightGatewayCredentials({
      baseUrl: 'https://gateway.example.com',
      lanUrl: 'http://192.168.1.20:18790',
      token: 'valid',
    })).resolves.toEqual({
      ok: true,
      winner: 'lan',
      url: 'http://192.168.1.20:18790',
      latencyMs: 24,
    });
  });

  it('reports a server error returned by the LAN route', async () => {
    raceGatewayRoutes.mockResolvedValue({
      winner: 'none',
      url: '',
      lan: { reachable: false, reason: 'http_error', httpStatus: 503 },
      tunnel: null,
    });

    const result = await preflightGatewayCredentials({
      baseUrl: 'https://gateway.example.com',
      lanUrl: 'http://192.168.1.20:18790',
      token: 'valid',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('server-error');
      expect(result.error.httpStatus).toBe(503);
    }
  });
});
