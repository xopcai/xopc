import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { buildMobilePairContext } from '../pair-context.js';

function baseConfig(overrides: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      host: '127.0.0.1',
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
      config: baseConfig({ bind: 'lan', host: '0.0.0.0' }),
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
      config: baseConfig({ bind: 'lan', host: '0.0.0.0' }),
      tunnelConnected: true,
      tunnelPublicUrl: 'https://abc123.frp.xopc.ai',
    });
    expect(ctx.connectUrls.at(-1)).toBe('https://abc123.frp.xopc.ai');
    expect(ctx.connectUrls[0]).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
  });
});
