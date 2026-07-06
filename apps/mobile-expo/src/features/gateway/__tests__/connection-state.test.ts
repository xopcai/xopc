import { describe, expect, it } from 'vitest';

import {
  deriveConnectionState,
  severityForConnectionState,
  type DeriveConnectionStateInput,
} from '../connection-state-derive';
import type { GatewayConnectionView } from '../gateway-connection-view';

function view(overrides: Partial<GatewayConnectionView> = {}): GatewayConnectionView {
  return {
    connectionKind: 'lan',
    activeUrl: 'http://192.168.1.10:18790',
    activeHost: '192.168.1.10:18790',
    lanUrl: 'http://192.168.1.10:18790',
    tunnelUrl: 'https://gw.example.com',
    lanHost: '192.168.1.10:18790',
    tunnelHost: 'gw.example.com',
    hasLanFallback: true,
    ...overrides,
  };
}

const baseInput: DeriveConnectionStateInput = {
  configured: true,
  unauthorized: false,
  gatewayOnline: true,
  view: view(),
  reachability: {
    lan: { status: 'reachable', latencyMs: 42 },
    tunnel: { status: 'reachable', latencyMs: 200 },
  },
  reachabilityChecking: false,
  networkOffline: false,
};

describe('deriveConnectionState', () => {
  it('returns ok-lan when LAN is reachable and active', () => {
    const state = deriveConnectionState(baseInput);
    expect(state.kind).toBe('ok-lan');
  });

  it('returns ok-tunnel when tunnel is the active route', () => {
    const state = deriveConnectionState({
      ...baseInput,
      view: view({ connectionKind: 'tunnel' }),
    });
    expect(state.kind).toBe('ok-tunnel');
  });

  it('returns degraded-tunnel-only when LAN is dead but tunnel reachable', () => {
    const state = deriveConnectionState({
      ...baseInput,
      view: view({ connectionKind: 'tunnel' }),
      reachability: {
        lan: { status: 'unreachable', reason: 'timeout' },
        tunnel: { status: 'reachable', latencyMs: 230 },
      },
    });
    expect(state.kind).toBe('degraded-tunnel-only');
  });

  it('returns offline-network when device has no internet', () => {
    const state = deriveConnectionState({
      ...baseInput,
      view: view({ connectionKind: 'tunnel' }),
      reachability: {
        lan: { status: 'unreachable' },
        tunnel: { status: 'unreachable' },
      },
      gatewayOnline: false,
      networkOffline: true,
    });
    expect(state.kind).toBe('offline-network');
  });

  it('returns offline-device when tunnel returns 5xx and LAN is dead', () => {
    const state = deriveConnectionState({
      ...baseInput,
      view: view({ connectionKind: 'tunnel' }),
      reachability: {
        lan: { status: 'unreachable', reason: 'timeout' },
        tunnel: { status: 'unreachable', reason: 'http_error', httpStatus: 502 },
      },
      gatewayOnline: false,
    });
    expect(state.kind).toBe('offline-device');
  });

  it('returns no-route when both routes unreachable without device-offline signature', () => {
    const state = deriveConnectionState({
      ...baseInput,
      reachability: {
        lan: { status: 'unreachable', reason: 'timeout' },
        tunnel: { status: 'unreachable', reason: 'timeout' },
      },
      gatewayOnline: false,
    });
    expect(state.kind).toBe('no-route');
  });

  it('returns initializing while a probe is in flight', () => {
    const state = deriveConnectionState({
      ...baseInput,
      gatewayOnline: false,
      reachability: {
        lan: { status: 'checking' },
        tunnel: { status: 'checking' },
      },
    });
    expect(state.kind).toBe('initializing');
  });

  it('routes 401 to token-invalid above all other states', () => {
    const state = deriveConnectionState({ ...baseInput, unauthorized: true });
    expect(state.kind).toBe('token-invalid');
  });

  it('returns unconfigured when no profile exists', () => {
    const state = deriveConnectionState({ ...baseInput, configured: false });
    expect(state.kind).toBe('unconfigured');
  });
});

describe('severityForConnectionState', () => {
  it('maps state kinds to severity buckets', () => {
    expect(severityForConnectionState({ kind: 'ok-lan' })).toBe('ok');
    expect(severityForConnectionState({ kind: 'ok-tunnel' })).toBe('ok');
    expect(severityForConnectionState({ kind: 'degraded-tunnel-only' })).toBe('warn');
    expect(severityForConnectionState({ kind: 'no-route' })).toBe('error');
    expect(severityForConnectionState({ kind: 'token-invalid' })).toBe('error');
    expect(severityForConnectionState({ kind: 'offline-network' })).toBe('error');
    expect(severityForConnectionState({ kind: 'offline-device' })).toBe('error');
    expect(severityForConnectionState({ kind: 'initializing' })).toBe('pending');
    expect(severityForConnectionState({ kind: 'unconfigured' })).toBe('idle');
  });
});
