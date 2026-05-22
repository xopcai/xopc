import { describe, expect, it } from 'vitest';

import {
  mapTunnelTrayStatus,
  pollIntervalForTunnelTrayStatus,
} from '../tunnel-tray-status.js';

describe('mapTunnelTrayStatus', () => {
  it('shows connecting when reconnecting even if enabled', () => {
    expect(mapTunnelTrayStatus({ enabled: true, state: 'reconnecting' })).toBe('connecting');
    expect(mapTunnelTrayStatus({ enabled: true, state: 'connecting' })).toBe('connecting');
  });

  it('shows connected only when state is connected', () => {
    expect(mapTunnelTrayStatus({ enabled: true, state: 'connected' })).toBe('connected');
  });

  it('shows off when disabled', () => {
    expect(mapTunnelTrayStatus({ enabled: false, state: 'disconnected' })).toBe('disconnected');
  });

  it('shows error state', () => {
    expect(mapTunnelTrayStatus({ enabled: false, state: 'error' })).toBe('error');
  });
});

describe('pollIntervalForTunnelTrayStatus', () => {
  it('polls faster while connecting', () => {
    expect(pollIntervalForTunnelTrayStatus('connecting')).toBe(5_000);
    expect(pollIntervalForTunnelTrayStatus('connected')).toBe(30_000);
  });
});
