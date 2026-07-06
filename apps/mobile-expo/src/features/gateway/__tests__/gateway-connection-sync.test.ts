import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateQueries, reconnect } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  reconnect: vi.fn(),
}));

vi.mock('../../../query/query-client', () => ({
  queryClient: { invalidateQueries },
}));

vi.mock('../../../query/keys', () => ({
  queryKeys: {
    sessionsAll: ['sessions'],
    home: ['home'],
    agents: ['agents'],
  },
}));

vi.mock('../use-gateway-sse', () => ({
  getSharedGatewaySseConnection: () => ({ reconnect }),
}));

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: vi.fn(() => ({ refreshActiveBaseUrl: vi.fn() })) },
}));

import {
  resetGatewaySyncStateForTests,
  syncGatewayAfterConnectivityChange,
} from '../gateway-connection-sync';

describe('syncGatewayAfterConnectivityChange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGatewaySyncStateForTests();
    invalidateQueries.mockClear();
    reconnect.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetGatewaySyncStateForTests();
  });

  it('debounces repeated sync calls', () => {
    syncGatewayAfterConnectivityChange();
    syncGatewayAfterConnectivityChange();
    expect(invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when requested', () => {
    syncGatewayAfterConnectivityChange({ immediate: true });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('respects minimum sync interval for debounced calls', () => {
    syncGatewayAfterConnectivityChange({ immediate: true });
    invalidateQueries.mockClear();
    reconnect.mockClear();

    syncGatewayAfterConnectivityChange();
    vi.advanceTimersByTime(2_000);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });
});
