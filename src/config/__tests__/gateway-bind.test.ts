import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { Config } from '../schema.js';
import {
  bindModeFromHostOverride,
  defaultGatewayBindMode,
  inferBindModeFromHost,
  isContainerEnvironment,
  resetContainerEnvironmentCacheForTest,
  resolveGatewayBindHostSync,
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
  syncLegacyGatewayHostFromBind,
} from '../gateway-bind.js';

describe('gateway-bind', () => {
  beforeEach(() => {
    resetContainerEnvironmentCacheForTest();
    delete process.env.XOPC_CONTAINER;
    delete process.env.KUBERNETES_SERVICE_HOST;
  });

  afterEach(() => {
    resetContainerEnvironmentCacheForTest();
  });

  it('infers bind mode from legacy host strings', () => {
    expect(inferBindModeFromHost('127.0.0.1')).toBe('loopback');
    expect(inferBindModeFromHost('0.0.0.0')).toBe('lan');
    expect(inferBindModeFromHost('192.168.1.2')).toBe('custom');
  });

  it('prefers explicit bind over legacy host', () => {
    const cfg = {
      gateway: { bind: 'loopback', host: '0.0.0.0' },
    } as Config;
    expect(resolveGatewayBindMode(cfg)).toBe('loopback');
    expect(resolveGatewayEffectiveHost(cfg)).toBe('127.0.0.1');
  });

  it('maps CLI host override to bind modes', () => {
    expect(bindModeFromHostOverride('0.0.0.0')).toEqual({ bind: 'lan' });
    expect(bindModeFromHostOverride('10.0.0.5')).toEqual({
      bind: 'custom',
      customBindHost: '10.0.0.5',
    });
  });

  it('uses container auto default when env indicates container', () => {
    process.env.XOPC_CONTAINER = '1';
    resetContainerEnvironmentCacheForTest();
    expect(defaultGatewayBindMode()).toBe('auto');
    expect(resolveGatewayBindHostSync({ bindMode: 'auto' })).toBe('0.0.0.0');
    expect(isContainerEnvironment()).toBe(true);
  });

  it('syncs legacy host from bind mode', () => {
    expect(syncLegacyGatewayHostFromBind({ bind: 'loopback' })).toBe('127.0.0.1');
    expect(syncLegacyGatewayHostFromBind({ bind: 'lan' })).toBe('0.0.0.0');
    expect(
      syncLegacyGatewayHostFromBind({ bind: 'custom', customBindHost: '192.168.0.8' }),
    ).toBe('192.168.0.8');
  });
});
