import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { configureTunnelFromGatewayConfig } from '../gateway-lifecycle.js';
import { getTunnelService } from '../tunnel-service.js';

describe('configureTunnelFromGatewayConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fail gateway configuration when an enabled public broker has no key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const config = {
      gateway: { host: '127.0.0.1', port: 18790 },
      tunnel: {
        enabled: true,
        autoStart: false,
        brokerUrl: 'https://frp.xopc.ai/api',
      },
    } as Config;

    await expect(
      configureTunnelFromGatewayConfig(config, {
        force: true,
        deferWellKnownFetch: true,
      }),
    ).resolves.toBeUndefined();

    expect(getTunnelService().getStatus().config.brokerUrl).toBe('https://frp.xopc.ai/api');
  });
});
