import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { clawHubMarketplaceAdapter } from '../adapters/clawhub/adapter.js';

describe('clawHubMarketplaceAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps same-slug search results separate by publisher', async () => {
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
          }, {
            slug: 'hyperframes',
            ownerHandle: 'other-publisher',
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
        id: 'heygen-com/hyperframes',
        name: 'Hyperframes',
      }),
      expect.objectContaining({ id: 'other-publisher/hyperframes' }),
    ]);
  });

  it('scopes detail, version, file and download requests to the selected publisher', async () => {
    vi.stubEnv('CLAWHUB_REGISTRY', 'https://claw.test');
    vi.stubEnv('XOPC_CLAWHUB_CACHE_MS', '60000');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const owner = url.searchParams.get('ownerHandle');
      if (!owner) return new Response('ambiguous', { status: 409 });
      if (url.pathname.endsWith('/versions/1.0.0')) {
        return Response.json({ version: { files: [{ path: 'SKILL.md' }] } });
      }
      if (url.pathname.endsWith('/file')) return new Response(`# ${owner}`);
      if (url.pathname.endsWith('/download')) {
        return new Response('archive', { headers: { 'content-type': 'application/zip' } });
      }
      return Response.json({
        skill: { slug: 'shared', displayName: 'Shared', summary: '', stats: { downloads: 0 } },
        latestVersion: { version: '1.0.0', createdAt: 0, changelog: null },
        owner: { handle: owner, image: null },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const config = ConfigSchema.parse(undefined);

    await expect(clawHubMarketplaceAdapter.getPackageDetail(config, 'shared')).rejects.toThrow('owner/slug');
    for (const owner of ['first', 'second']) {
      const reference = `${owner}/shared`;
      await expect(clawHubMarketplaceAdapter.getPackageDetail(config, reference)).resolves.toMatchObject({
        id: reference, name: 'shared', readme: `# ${owner}`,
      });
      await expect(clawHubMarketplaceAdapter.downloadPackage(config, reference, '1.0.0')).resolves.toMatchObject({
        skillId: 'shared', version: '1.0.0',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `https://claw.test/api/v1/download?slug=shared&ownerHandle=${owner}&version=1.0.0`,
        expect.anything(),
      );
    }
  });
});
