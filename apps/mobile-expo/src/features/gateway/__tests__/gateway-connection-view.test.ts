import { describe, expect, it } from 'vitest';

import {
  deriveGatewayConnectionView,
  formatGatewayHost,
  normalizeGatewayBaseUrl,
} from '../gateway-connection-view';

describe('normalizeGatewayBaseUrl', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeGatewayBaseUrl('  http://a/  ')).toBe('http://a');
  });

  it('adds http for private LAN addresses without scheme', () => {
    expect(normalizeGatewayBaseUrl('192.168.1.10:18790')).toBe('http://192.168.1.10:18790');
  });
});

describe('formatGatewayHost', () => {
  it('shows host:port for non-default http port', () => {
    expect(formatGatewayHost('http://192.168.1.10:18790')).toBe('192.168.1.10:18790');
  });

  it('omits default https port', () => {
    expect(formatGatewayHost('https://abc.frp.xopc.ai')).toBe('abc.frp.xopc.ai');
  });
});

describe('deriveGatewayConnectionView', () => {
  const tunnel = 'https://abc.frp.xopc.ai';
  const lan = 'http://192.168.1.10:18790';

  it('returns unconfigured when baseUrl empty', () => {
    expect(deriveGatewayConnectionView({ baseUrl: '', lanUrl: null, activeBaseUrl: '' }).connectionKind).toBe(
      'unconfigured',
    );
  });

  it('detects LAN when active matches lanUrl', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: lan,
    });
    expect(view.connectionKind).toBe('lan');
    expect(view.activeHost).toBe('192.168.1.10:18790');
    expect(view.lanHost).toBe('192.168.1.10:18790');
    expect(view.tunnelHost).toBe('abc.frp.xopc.ai');
  });

  it('detects tunnel when LAN fallback exists but active is public URL', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: tunnel,
    });
    expect(view.connectionKind).toBe('tunnel');
    expect(view.hasLanFallback).toBe(true);
  });

  it('detects direct when no lanUrl', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: null,
      activeBaseUrl: tunnel,
    });
    expect(view.connectionKind).toBe('direct');
    expect(view.hasLanFallback).toBe(false);
  });

  it('returns indeterminate when active does not match known URLs', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: 'http://10.0.0.9:18790',
    });
    expect(view.connectionKind).toBe('indeterminate');
  });

  it('returns indeterminate before first probe when activeBaseUrl empty', () => {
    const view = deriveGatewayConnectionView({
      baseUrl: tunnel,
      lanUrl: lan,
      activeBaseUrl: '',
    });
    expect(view.connectionKind).toBe('indeterminate');
  });
});
