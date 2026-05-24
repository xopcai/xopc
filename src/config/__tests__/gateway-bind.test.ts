import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { Config } from '../schema.js';
import {
  defaultGatewayBindMode,
  isContainerEnvironment,
  resetContainerEnvironmentCacheForTest,
  resolveGatewayBindHostSync,
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
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

  it('uses explicit bind mode from config', () => {
    const cfg = {
      gateway: { bind: 'loopback' },
    } as Config;
    expect(resolveGatewayBindMode(cfg)).toBe('loopback');
    expect(resolveGatewayEffectiveHost(cfg)).toBe('127.0.0.1');
  });

  it('resolves custom bind host from config', () => {
    const cfg = {
      gateway: { bind: 'custom', customBindHost: '192.168.1.2' },
    } as Config;
    expect(resolveGatewayBindMode(cfg)).toBe('custom');
    expect(resolveGatewayEffectiveHost(cfg)).toBe('192.168.1.2');
  });

  it('uses container auto default when env indicates container', () => {
    process.env.XOPC_CONTAINER = '1';
    resetContainerEnvironmentCacheForTest();
    expect(defaultGatewayBindMode()).toBe('auto');
    expect(resolveGatewayBindHostSync({ bindMode: 'auto' })).toBe('0.0.0.0');
    expect(isContainerEnvironment()).toBe(true);
  });
});
