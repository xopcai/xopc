import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { clawHubMarketplaceAdapter } from '../adapters/clawhub/adapter.js';

describe('clawHubMarketplaceAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the slug accepted by detail and download APIs instead of federated ids', async () => {
    vi.stubEnv('CLAWHUB_REGISTRY', 'https://claw.test');
    vi.stubEnv('XOPC_CLAWHUB_CACHE_MS', '0');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://claw.test/api/v1/search')) {
        return new Response(JSON.stringify({
          results: [{
            id: 'clawhub:kd77ckmst8xxeas0rtthhvg9rd81mb2x',
            slug: 'hyperframes',
            source: 'clawhub',
            displayName: 'Hyperframes',
            install: { kind: 'clawhub', reference: 'heygen-com/hyperframes' },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));

    const response = await clawHubMarketplaceAdapter.listPackages(
      ConfigSchema.parse(undefined),
      { q: 'hyperframes' },
    );

    expect(response.items).toEqual([
      expect.objectContaining({
        id: 'hyperframes',
        name: 'Hyperframes',
      }),
    ]);
  });
});
