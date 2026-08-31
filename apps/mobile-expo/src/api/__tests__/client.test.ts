import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  activeBaseUrl: 'http://lan.gateway',
  baseUrl: 'https://tunnel.gateway',
  lanUrl: 'http://lan.gateway',
  token: 'token-1',
}));

vi.mock('../../features/gateway/connection-log', () => ({
  recordConnectionEvent: vi.fn(),
}));

vi.mock('../../features/gateway/network-info', () => ({
  getNetworkSnapshot: () => ({ kind: 'wifi', key: 'wifi:test' }),
}));

vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({
      ...gateway,
      apiUrl: (path: string) => `${gateway.activeBaseUrl}${path}`,
      refreshActiveBaseUrl: vi.fn(async () => {
        gateway.activeBaseUrl = gateway.baseUrl;
        return gateway.activeBaseUrl;
      }),
    }),
  },
}));

vi.mock('../dual-fire-fetch', () => ({
  dualFireFetch: vi.fn(),
  hasCachedRouteWinner: vi.fn(() => true),
}));

vi.mock('../notify-unauthorized', () => ({
  notifyUnauthorizedIfNeeded: vi.fn(),
}));

import { apiFetch } from '../client';

describe('apiFetch route recovery', () => {
  beforeEach(() => {
    gateway.activeBaseUrl = gateway.lanUrl;
    vi.restoreAllMocks();
  });

  it('re-resolves LAN versus tunnel and retries an explicitly replay-safe POST once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const response = await apiFetch('/api/notes', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'voice-operation-1' },
      body: JSON.stringify({ kind: 'voice' }),
      recoverRouteOnNetworkError: true,
    });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://lan.gateway/api/notes');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://tunnel.gateway/api/notes');
  });
});
