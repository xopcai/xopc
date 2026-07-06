import { describe, expect, it } from 'vitest';

import {
  buildTunnelQrPatch,
  shouldUpdateBaseUrlFromPublicUrl,
} from '../tunnel-qr-merge';

describe('shouldUpdateBaseUrlFromPublicUrl', () => {
  it('allows update when current base is empty', () => {
    expect(shouldUpdateBaseUrlFromPublicUrl('', 'https://abc.frp.xopc.ai')).toBe(true);
  });

  it('allows update when host matches', () => {
    expect(
      shouldUpdateBaseUrlFromPublicUrl(
        'https://abc.frp.xopc.ai/',
        'https://abc.frp.xopc.ai',
      ),
    ).toBe(true);
  });

  it('blocks update when user pointed baseUrl at a different host', () => {
    expect(
      shouldUpdateBaseUrlFromPublicUrl(
        'https://custom.example.com',
        'https://abc.frp.xopc.ai',
      ),
    ).toBe(false);
  });

  it('blocks update when publicUrl is null', () => {
    expect(shouldUpdateBaseUrlFromPublicUrl('https://abc.frp.xopc.ai', null)).toBe(false);
  });
});

describe('buildTunnelQrPatch', () => {
  it('always includes lanUrl from response', () => {
    const patch = buildTunnelQrPatch(
      {
        qrPayload: 'xopc://',
        publicUrl: 'https://new.frp.xopc.ai',
        lanUrl: 'http://10.0.0.2:18790',
      },
      'https://old.frp.xopc.ai',
    );
    expect(patch.lanUrl).toBe('http://10.0.0.2:18790');
    expect(patch.baseUrl).toBeUndefined();
  });

  it('includes baseUrl when host matches', () => {
    const patch = buildTunnelQrPatch(
      {
        qrPayload: '',
        publicUrl: 'https://abc.frp.xopc.ai/',
        lanUrl: null,
      },
      'https://abc.frp.xopc.ai',
    );
    expect(patch.lanUrl).toBe(null);
    expect(patch.baseUrl).toBe('https://abc.frp.xopc.ai');
  });
});
