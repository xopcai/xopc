import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../src/config/schema.js';
import { ensureGatewayCorsOriginsForNetworkBind } from '../../src/gateway/ensure-network-cors.js';

describe('ensureGatewayCorsOriginsForNetworkBind', () => {
  it('adds default corsOrigins for lan bind without origins', () => {
    const config = ConfigSchema.parse({
      gateway: {
        bind: 'lan',
        port: 28790,
        auth: { mode: 'token', token: 'a'.repeat(32) },
        corsOrigins: [],
      },
    });
    const next = ensureGatewayCorsOriginsForNetworkBind(config, 28790);
    expect(next.gateway?.corsOrigins).toEqual([
      'http://localhost:28790',
      'http://127.0.0.1:28790',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
    ]);
  });

  it('leaves loopback bind unchanged', () => {
    const config = ConfigSchema.parse({
      gateway: {
        bind: 'loopback',
        port: 28790,
        auth: { mode: 'token', token: 'a'.repeat(32) },
        corsOrigins: [],
      },
    });
    const next = ensureGatewayCorsOriginsForNetworkBind(config, 28790);
    expect(next.gateway?.corsOrigins).toEqual([]);
  });
});
