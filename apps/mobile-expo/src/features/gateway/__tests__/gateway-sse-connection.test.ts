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

function configureGatewayStore(): void {
  useGatewayStore.setState({
    baseUrl: 'http://127.0.0.1:18789',
    activeBaseUrl: 'http://127.0.0.1:18789',
  });
}

class FakeXmlHttpRequest {
  responseText = '';
  readyState = 0;
  status = 200;
  onprogress: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn();

  emitProgress(responseText: string): void {
    this.responseText = responseText;
    this.readyState = 3;
    this.onprogress?.();
  }

  emitLoad(responseText: string): void {
    this.responseText = responseText;
    this.readyState = 4;
    this.onload?.();
  }
}

describe('GatewaySseConnection', () => {
  beforeEach(() => {
    resetGatewayStore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not throw or open a transport when gateway base URL is not configured', () => {
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);

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

  it('cancels a pending fast reconnect when disconnected', () => {
    vi.useFakeTimers();
    configureGatewayStore();
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    const connection = new GatewaySseConnection({
      onConnected: vi.fn(),
      onReconnecting: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    });

    connection.reconnect();
    connection.disconnect();
    vi.advanceTimersByTime(100);

    expect(xhr).not.toHaveBeenCalled();
  });

  it('rotates an oversized XHR response only at an SSE event boundary', () => {
    vi.useFakeTimers();
    configureGatewayStore();
    const requests: FakeXmlHttpRequest[] = [];
    class CapturingXmlHttpRequest extends FakeXmlHttpRequest {
      constructor() {
        super();
        requests.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', CapturingXmlHttpRequest);
    const callbacks = {
      onConnected: vi.fn(),
      onReconnecting: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    };
    const connection = new GatewaySseConnection(callbacks);

    connection.connect();
    const firstRequest = requests[0];
    firstRequest.emitLoad(': keepalive\n'.repeat(48_000));

    expect(firstRequest.abort).toHaveBeenCalledOnce();
    expect(callbacks.onReconnecting).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(requests).toHaveLength(2);
  });

  it('waits for an SSE event boundary before rotating an oversized response', () => {
    vi.useFakeTimers();
    configureGatewayStore();
    const requests: FakeXmlHttpRequest[] = [];
    class CapturingXmlHttpRequest extends FakeXmlHttpRequest {
      constructor() {
        super();
        requests.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', CapturingXmlHttpRequest);
    const connection = new GatewaySseConnection({
      onConnected: vi.fn(),
      onReconnecting: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    });

    connection.connect();
    requests[0].emitProgress(`event: update\ndata: ${'x'.repeat(512 * 1024)}`);

    expect(requests[0].abort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(requests).toHaveLength(1);
  });
});
