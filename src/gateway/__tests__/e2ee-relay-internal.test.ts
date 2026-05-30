import { describe, expect, it } from 'vitest';

import { resolveInternalGatewayRelayBaseUrl } from '../hono/routes/e2ee.js';

describe('resolveInternalGatewayRelayBaseUrl', () => {
  it('uses loopback port from gateway config', () => {
    const url = resolveInternalGatewayRelayBaseUrl({
      currentConfig: { gateway: { port: 18790 } },
    } as never);
    expect(url).toBe('http://127.0.0.1:18790');
  });
});
