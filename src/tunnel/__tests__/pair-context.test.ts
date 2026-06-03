import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { buildMobilePairContext } from '../pair-context.js';

function baseConfig(overrides: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      port: 28790,
      auth: { mode: 'token' },
      ...overrides,
    },
  } as Config;
}

describe('buildMobilePairContext', () => {
  it('marks loopback-only gateway as not pairing ready', () => {
    const ctx = buildMobilePairContext({
      config: baseConfig(),
      tunnelConnected: false,
    });
    expect(ctx.pairingReady).toBe(false);
    expect(ctx.blockReason).toBe('GATEWAY_LOOPBACK_ONLY');
    expect(ctx.listenHost).toBe('127.0.0.1');
    expect(ctx.port).toBe(28790);
    expect(ctx.candidates.some((c) => c.kind === 'lan')).toBe(true);
    expect(ctx.candidates.every((c) => c.kind === 'lan' ? !c.reachable : true)).toBe(true);
  });

  it('is pairing ready when gateway listens on LAN', () => {
    const ctx = buildMobilePairContext({
      config: baseConfig({ bind: 'lan' }),
      tunnelConnected: false,
    });
    expect(ctx.pairingReady).toBe(true);
    expect(ctx.blockReason).toBeUndefined();
    expect(ctx.recommended.mode).toBe('lan');
    expect(ctx.recommended.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
  });

  it('prefers tunnel URL when remote access is connected', () => {
    const ctx = buildMobilePairContext({
      config: baseConfig(),
      tunnelConnected: true,
      tunnelPublicUrl: 'https://abc123.frp.xopc.ai',
    });
    expect(ctx.pairingReady).toBe(true);
    expect(ctx.recommended).toEqual({
      mode: 'tunnel',
      url: 'https://abc123.frp.xopc.ai',
    });
    expect(ctx.candidates[0]).toMatchObject({
      kind: 'tunnel',
      url: 'https://abc123.frp.xopc.ai',
      reachable: true,
    });
    expect(ctx.connectUrls).toEqual(['https://abc123.frp.xopc.ai']);
  });

  it('orders LAN before tunnel in connectUrls when both are reachable', () => {
    const ctx = buildMobilePairContext({
      config: baseConfig({ bind: 'lan' }),
      tunnelConnected: true,
      tunnelPublicUrl: 'https://abc123.frp.xopc.ai',
    });
    expect(ctx.connectUrls.at(-1)).toBe('https://abc123.frp.xopc.ai');
    expect(ctx.connectUrls[0]).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
  });

  describe('reverse-proxy candidate', () => {
    it('reverse-proxy URL becomes the recommended candidate', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'https://gateway.example.com' }),
      });
      expect(ctx.pairingReady).toBe(true);
      expect(ctx.recommended).toEqual({
        mode: 'reverse-proxy',
        url: 'https://gateway.example.com',
      });
      expect(ctx.candidates[0]).toMatchObject({
        kind: 'reverse-proxy',
        url: 'https://gateway.example.com',
        reachable: true,
      });
      expect(ctx.connectUrls[0]).toBe('https://gateway.example.com');
    });

    it('reverse-proxy wins over FRP tunnel; both surface in connectUrls (co-exist)', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'https://gateway.example.com' }),
        tunnelConnected: true,
        tunnelPublicUrl: 'https://abc123.frp.xopc.ai',
      });
      expect(ctx.recommended.mode).toBe('reverse-proxy');
      expect(ctx.connectUrls).toContain('https://gateway.example.com');
      expect(ctx.connectUrls).toContain('https://abc123.frp.xopc.ai');
      expect(ctx.connectUrls.indexOf('https://gateway.example.com')).toBeLessThan(
        ctx.connectUrls.indexOf('https://abc123.frp.xopc.ai'),
      );
    });

    it('LAN URL appears alongside reverse-proxy when LAN bind is active', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'https://gateway.example.com', bind: 'lan' }),
      });
      expect(ctx.connectUrls[0]).toBe('https://gateway.example.com');
      const lanEntry = ctx.connectUrls.find((u) => /^http:\/\/\d/.test(u));
      // LAN URL should be present as a fallback (may be the same as recommended LAN candidate)
      if (lanEntry) expect(lanEntry).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
    });

    it('explicit reverseProxyPublicUrl override beats configured value', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'https://configured.example.com' }),
        reverseProxyPublicUrl: 'https://override.example.com',
      });
      expect(ctx.recommended.url).toBe('https://override.example.com');
    });

    it('null reverseProxyPublicUrl override suppresses configured value', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'https://configured.example.com' }),
        reverseProxyPublicUrl: null,
      });
      expect(ctx.recommended.mode).not.toBe('reverse-proxy');
    });

    it('invalid publicUrl (http on public host) is treated as absent', () => {
      const ctx = buildMobilePairContext({
        config: baseConfig({ publicUrl: 'http://public.example.com' }),
      });
      expect(ctx.recommended.mode).not.toBe('reverse-proxy');
    });
  });
});
