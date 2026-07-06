import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isLoopbackGatewayBaseUrl,
  preferredActiveBaseUrlFromFlat,
  resolveEffectiveGatewayBaseUrl,
  shouldRejectLoopbackGatewayBaseUrl,
} from '../gateway-types';

describe('isLoopbackGatewayBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects localhost and 127.x addresses', () => {
    expect(isLoopbackGatewayBaseUrl('http://127.0.0.1:28790')).toBe(true);
    expect(isLoopbackGatewayBaseUrl('http://127.0.0.2:18790')).toBe(true);
    expect(isLoopbackGatewayBaseUrl('http://192.168.1.5:28790')).toBe(false);
  });

  it('allows loopback gateway URLs only in dev builds', () => {
    expect(shouldRejectLoopbackGatewayBaseUrl('http://127.0.0.1:28790')).toBe(true);

    vi.stubGlobal('__DEV__', true);

    expect(shouldRejectLoopbackGatewayBaseUrl('http://127.0.0.1:28790')).toBe(false);
  });
});

describe('resolveEffectiveGatewayBaseUrl', () => {
  it('prefers activeBaseUrl, then baseUrl, then lanUrl', () => {
    expect(
      resolveEffectiveGatewayBaseUrl({
        activeBaseUrl: 'http://192.168.1.44:18790',
        baseUrl: 'https://frp.example.com',
        lanUrl: 'http://10.0.0.2:18790',
      }),
    ).toBe('http://192.168.1.44:18790');

    expect(
      resolveEffectiveGatewayBaseUrl({
        activeBaseUrl: '',
        baseUrl: 'https://frp.example.com',
        lanUrl: 'http://192.168.1.44:18790',
      }),
    ).toBe('https://frp.example.com');

    expect(
      resolveEffectiveGatewayBaseUrl({
        activeBaseUrl: '',
        baseUrl: '',
        lanUrl: '192.168.1.44:18790',
      }),
    ).toBe('http://192.168.1.44:18790');
  });
});

describe('preferredActiveBaseUrlFromFlat', () => {
  it('prefers LAN over tunnel for optimistic routing', () => {
    expect(
      preferredActiveBaseUrlFromFlat({
        baseUrl: 'https://frp.example.com',
        lanUrl: 'http://192.168.1.44:18790',
      }),
    ).toBe('http://192.168.1.44:18790');
  });
});
