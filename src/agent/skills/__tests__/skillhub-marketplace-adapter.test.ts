import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { skillHubMarketplaceAdapter } from '../marketplace/adapters/skillhub/adapter.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('skillHubMarketplaceAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back to registry-backed skillsets when curated index is empty', async () => {
    vi.stubEnv('XOPC_SKILLHUB_CACHE_MS', '0');

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json')) {
        return jsonResponse({ total: 0, skills: [] });
      }
      if (url.includes('api.skillhub.cn/api/v1/skillsets')) {
        return jsonResponse({
          total: 1,
          skillSets: [
            {
              id: 1,
              slug: 'developer-testing',
              displayName: 'Developer Testing',
              summary: 'Testing workflow',
              scene: 'tech',
              subScene: 'test',
              content: '',
              skillSlugs: ['tdd-guide'],
              skillCount: 1,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        });
      }
      if (url.includes('api.skillhub.cn/api/v1/skills/batch')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({
          count: 1,
          missing: [],
          items: [
            {
              latestVersion: { version: '2.1.1', changelog: null, createdAt: 3 },
              owner: { handle: 'skillhub', displayName: 'SkillHub', image: null },
              skill: {
                slug: 'tdd-guide',
                displayName: 'Tdd Guide',
                summary: 'Test-driven development skill',
                summary_zh: '测试驱动开发技能',
                category: 'developer-tools',
                iconUrl: null,
                source: 'clawhub',
                labels: {},
                stats: {
                  downloads: 100,
                  installs: 10,
                  stars: 5,
                  comments: 0,
                  versions: 2,
                },
                createdAt: 1,
                updatedAt: 4,
                tags: { latest: '2.1.1' },
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const payload = await skillHubMarketplaceAdapter.listPackages(ConfigSchema.parse({}), {
      page: 1,
      pageSize: 20,
      sort: 'downloads',
    });

    expect(payload.provider).toBe('skillhub');
    expect(payload.meta.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: 'tdd-guide',
      name: 'Tdd Guide',
      description: '测试驱动开发技能',
      downloads: 100,
    });
  });
});
