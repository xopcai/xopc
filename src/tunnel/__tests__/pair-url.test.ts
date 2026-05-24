import { describe, expect, it } from 'vitest';

import {
  buildMobileConnectUrlOrder,
  isLoopbackGatewayBaseUrl,
  normalizeGatewayBaseUrl,
  parseMobileConnectDeepLink,
  validateMobilePairBaseUrl,
} from '../pair-url.js';

describe('normalizeGatewayBaseUrl', () => {
  it('normalizes http roots without trailing slash', () => {
    expect(normalizeGatewayBaseUrl('http://192.168.1.5:28790/')).toBe('http://192.168.1.5:28790');
  });

  it('rejects paths and credentials', () => {
    expect(normalizeGatewayBaseUrl('http://192.168.1.5:28790/api')).toBeNull();
    expect(normalizeGatewayBaseUrl('http://user:pass@192.168.1.5:28790')).toBeNull();
  });
});

describe('isLoopbackGatewayBaseUrl', () => {
  it('detects localhost and 127.x', () => {
    expect(isLoopbackGatewayBaseUrl('http://127.0.0.1:28790')).toBe(true);
    expect(isLoopbackGatewayBaseUrl('http://localhost:18790')).toBe(true);
    expect(isLoopbackGatewayBaseUrl('http://127.0.0.2:28790')).toBe(true);
  });

  it('allows LAN and tunnel URLs', () => {
    expect(isLoopbackGatewayBaseUrl('http://192.168.1.5:28790')).toBe(false);
    expect(isLoopbackGatewayBaseUrl('https://abc.frp.xopc.ai')).toBe(false);
  });
});

describe('validateMobilePairBaseUrl', () => {
  it('rejects loopback manual config', () => {
    const result = validateMobilePairBaseUrl('http://127.0.0.1:28790');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LOOPBACK_NOT_REACHABLE');
    }
  });

  it('accepts LAN URLs', () => {
    const result = validateMobilePairBaseUrl('http://192.168.1.5:28790');
    expect(result).toEqual({ ok: true, url: 'http://192.168.1.5:28790', loopback: false });
  });
});

describe('parseMobileConnectDeepLink', () => {
  it('parses mobile-connect deep links', () => {
    const parsed = parseMobileConnectDeepLink(
      'xopc://gateway/mobile-connect?baseUrl=http%3A%2F%2F192.168.1.5%3A28790&lanUrl=http%3A%2F%2F10.0.0.2%3A28790&ps=secret123',
    );
    expect(parsed).toEqual({
      baseUrl: 'http://192.168.1.5:28790',
      lanUrl: 'http://10.0.0.2:28790',
      pairingSecret: 'secret123',
    });
  });
});

describe('buildMobileConnectUrlOrder', () => {
  it('prefers lanUrl before tunnel baseUrl', () => {
    expect(
      buildMobileConnectUrlOrder({
        baseUrl: 'https://abc.frp.xopc.ai',
        lanUrl: 'http://192.168.1.5:28790',
      }),
    ).toEqual(['http://192.168.1.5:28790', 'https://abc.frp.xopc.ai']);
  });

  it('drops loopback entries', () => {
    expect(
      buildMobileConnectUrlOrder({
        baseUrl: 'http://127.0.0.1:28790',
        lanUrl: 'http://192.168.1.5:28790',
      }),
    ).toEqual(['http://192.168.1.5:28790']);
  });
});
