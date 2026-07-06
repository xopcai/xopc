import { describe, expect, it } from 'vitest';

import type { TunnelStatusResponse } from '../../../api/tunnel';
import { resolveTunnelStatusUiKey, tunnelStatusDetailLine } from '../tunnel-status-display';

const baseStatus: TunnelStatusResponse = {
  enabled: true,
  state: 'disconnected',
  subdomain: null,
  publicUrl: null,
  connectedSince: null,
  frpcPid: null,
  lastHeartbeatAt: null,
  lastError: null,
  config: { autoStart: false, brokerUrl: 'https://frp.xopc.ai/api' },
};

describe('resolveTunnelStatusUiKey', () => {
  it('returns unavailable without token', () => {
    expect(resolveTunnelStatusUiKey({ loading: false, hasToken: false, status: null })).toBe(
      'unavailable',
    );
  });

  it('returns loading while fetching', () => {
    expect(resolveTunnelStatusUiKey({ loading: true, hasToken: true, status: null })).toBe('loading');
  });

  it('maps connected state', () => {
    expect(
      resolveTunnelStatusUiKey({
        loading: false,
        hasToken: true,
        status: { ...baseStatus, state: 'connected' },
      }),
    ).toBe('connected');
  });

  it('maps reconnecting to connecting', () => {
    expect(
      resolveTunnelStatusUiKey({
        loading: false,
        hasToken: true,
        status: { ...baseStatus, state: 'reconnecting' },
      }),
    ).toBe('connecting');
  });

  it('maps error state', () => {
    expect(
      resolveTunnelStatusUiKey({
        loading: false,
        hasToken: true,
        status: { ...baseStatus, state: 'error' },
      }),
    ).toBe('error');
  });

  it('maps disconnected to off', () => {
    expect(
      resolveTunnelStatusUiKey({
        loading: false,
        hasToken: true,
        status: { ...baseStatus, state: 'disconnected' },
      }),
    ).toBe('off');
  });
});

describe('tunnelStatusDetailLine', () => {
  it('prefers lastError on error state', () => {
    expect(
      tunnelStatusDetailLine({
        ...baseStatus,
        state: 'error',
        lastError: 'frpc exited',
        publicUrl: 'https://abc.frp.xopc.ai',
      }),
    ).toBe('frpc exited');
  });

  it('shows public URL host when connected', () => {
    expect(
      tunnelStatusDetailLine({
        ...baseStatus,
        state: 'connected',
        publicUrl: 'https://abc123.frp.xopc.ai',
      }),
    ).toBe('abc123.frp.xopc.ai');
  });
});
