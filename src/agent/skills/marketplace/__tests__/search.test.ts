import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { downloadFromMarketplace } from '../../skills-marketplace.js';
import { searchSkillMarketplaces } from '../search.js';

describe('searchSkillMarketplaces', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('preserves federated provenance and reads adoption metrics from ClawHub search hits', async () => {
    vi.stubEnv('CLAWHUB_REGISTRY', 'https://claw.test');
    vi.stubEnv('XOPC_CLAWHUB_CACHE_MS', '0');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://store.test/')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'store-react',
            name: 'react-toolkit',
            type: 'skill',
            description: 'Store result',
            downloads: 500,
            author: { username: 'xopc', avatarUrl: null },
            updatedAt: '1781568445',
            stars: 5,
          }],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('https://claw.test/api/v1/search')) {
        return new Response(JSON.stringify({
          results: [
            {
              id: 'clawhub:native-react',
              slug: 'react',
              source: 'clawhub',
              downloads: 8228,
              displayName: 'React',
              summary: 'Native result',
              canonicalUrl: '/ivangdavila/skills/react',
              install: { kind: 'clawhub', reference: 'ivangdavila/react', sourceUrl: null },
              publisher: { handle: 'ivangdavila' },
              metrics: { bookmarks: 3, updatedAt: 1_786_000_000_000 },
            },
            {
              id: 'skills-sh:lobehub/lobehub/react',
              slug: 'react',
              source: 'skills-sh',
              downloads: 3258,
              displayName: 'React',
              summary: 'Federated result',
              canonicalUrl: '/skills-sh/lobehub/lobehub/react',
              install: {
                kind: 'skills-sh',
                reference: 'skills-sh:lobehub/lobehub/react',
                sourceUrl: 'https://skills.sh/lobehub/lobehub/react',
              },
              sourceIdentity: { owner: 'lobehub', repo: 'lobehub' },
              metrics: { updatedAt: 1_785_000_000_000 },
              trust: {
                upstreamScanners: {
                  snyk: {
                    status: 'warn',
                    sourceCheckedAt: '2026-03-07T02:43:02.954Z',
                    sourceUrl: 'https://skills.sh/lobehub/lobehub/react/security/snyk',
                  },
                },
              },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));

    const config = ConfigSchema.parse(undefined);
    config.gateway.skillsStoreBaseUrl = 'https://store.test';
    const response = await searchSkillMarketplaces({ config, query: 'react', limit: 10 });

    expect(response.sources).toEqual([
      { source: 'store', ok: true, count: 1 },
      { source: 'clawhub', ok: true, count: 1 },
      { source: 'skills-sh', ok: true, count: 1, via: 'clawhub' },
    ]);
    expect(response.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'clawhub:native-react',
        source: 'clawhub',
        downloads: 8228,
        canonicalUrl: 'https://claw.test/ivangdavila/skills/react',
        install: expect.objectContaining({ reference: 'ivangdavila/react' }),
      }),
      expect.objectContaining({
        id: 'skills-sh:lobehub/lobehub/react',
        source: 'skills-sh',
        downloads: 3258,
        install: expect.objectContaining({ reference: 'skills-sh:lobehub/lobehub/react' }),
        security: {
          status: 'warn',
          scanners: [expect.objectContaining({ name: 'snyk', status: 'warn' })],
        },
      }),
      expect.objectContaining({
        id: 'store-react',
        updatedAt: '2026-06-16T00:07:25.000Z',
      }),
    ]));
  });

  it('downloads an owner-scoped ClawHub reference without collapsing it to a slug', async () => {
    vi.stubEnv('CLAWHUB_REGISTRY', 'https://claw.test');
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadFromMarketplace(
      ConfigSchema.parse(undefined),
      'heygen-com/hyperframes',
      undefined,
      'clawhub',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://claw.test/api/v1/download?slug=hyperframes&ownerHandle=heygen-com',
      { redirect: 'follow' },
    );
    expect(result.skillId).toBe('hyperframes');
  });
});
