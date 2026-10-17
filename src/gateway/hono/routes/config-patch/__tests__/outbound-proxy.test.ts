import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../../config/schema.js';
import { buildReloadPlan } from '../../../../../config/rules.js';
import { applyGatewayPatch } from '../gateway.js';

describe('outbound proxy configuration', () => {
  it('saves a validated proxy without changing listen or authentication settings', () => {
    const config = ConfigSchema.parse({ gateway: { port: 18790, auth: { mode: 'token', token: 'fixture' } } });
    expect(applyGatewayPatch(config, { gateway: { outboundProxy: { mode: 'custom', url: ' http://127.0.0.1:7897 ' } } }).ok).toBe(true);
    expect(config.gateway.outboundProxy).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7897', noProxy: '' });
    expect(config.gateway.auth?.token).toBe('fixture');
    expect(config.gateway.port).toBe(18790);
    expect(buildReloadPlan(['gateway.outboundProxy.url']).requiresRestart).toBe(true);
  });
  it.each(['', 'socks5://127.0.0.1:7897', 'file:///tmp/proxy', 'http://user:secret@proxy.test', 'http://proxy.test/path', 'http://proxy.test?token=secret'])('rejects unsupported or credential-bearing proxy addresses: %s', url => {
    const config = ConfigSchema.parse({});
    expect(applyGatewayPatch(config, { gateway: { outboundProxy: { mode: 'custom', url } } }).ok).toBe(false);
    expect(config.gateway.outboundProxy).toBeUndefined();
    expect(ConfigSchema.safeParse({ gateway: { outboundProxy: { mode: 'custom', url } } }).success).toBe(false);
  });
  it.each(['environment', 'direct'])('allows %s mode without an address', mode => {
    const config = ConfigSchema.parse({});
    expect(applyGatewayPatch(config, { gateway: { outboundProxy: { mode } } }).ok).toBe(true);
  });
});
