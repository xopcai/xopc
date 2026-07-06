import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../probe-coordinator', () => ({
  runProbeRound: vi.fn(async () => undefined),
}));

vi.mock('../last-good-route', () => ({
  readAnyNetworkLastGoodRoute: vi.fn(() => null),
}));

vi.mock('../route-override', () => ({
  readRouteOverride: vi.fn(() => 'auto'),
  writeRouteOverride: vi.fn(),
}));

vi.mock('../../../storage/mmkv', () => ({
  KEYS: {
    baseUrl: 'gateway.baseUrl',
    lanUrl: 'gateway.lanUrl',
    token: 'gateway.token',
    profiles: 'gateway.profiles',
    activeId: 'gateway.activeId',
    routeWinnerPrefix: 'gateway.routeWinner:',
    routeOverridePrefix: 'gateway.routeOverride:',
  },
  storage: {
    getString: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../storage/gateway-token-storage', () => ({
  readGatewayToken: vi.fn(() => ''),
  writeGatewayToken: vi.fn(),
  deleteGatewayToken: vi.fn(),
}));

import { useGatewayStore } from '../../../stores/gateway-store';
import { GatewaySseConnection } from '../gateway-sse-connection';

function resetGatewayStore(): void {
  useGatewayStore.setState({
    profiles: [],
    activeGatewayId: null,
    baseUrl: '',
    lanUrl: null,
    activeBaseUrl: '',
    token: '',
    unauthorized: false,
  });
}

describe('GatewaySseConnection', () => {
  beforeEach(() => {
    resetGatewayStore();
    vi.restoreAllMocks();
  });

  it('does not throw or open a transport when gateway base URL is not configured', () => {
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('EventSource', undefined);

    const callbacks = {
      onConnected: vi.fn(),
      onReconnecting: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    };
    const connection = new GatewaySseConnection(callbacks);

    expect(() => connection.connect()).not.toThrow();
    expect(xhr).not.toHaveBeenCalled();
    expect(callbacks.onDisconnected).toHaveBeenCalledTimes(1);
    expect(callbacks.onReconnecting).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
