import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import type { SkillManager } from '../../skills/skill-manager.js';
import { getToolMetadata } from '../metadata.js';
import { createSkillsMarketplaceSearchTool } from '../skills-marketplace-search-tool.js';

describe('skills_marketplace_search', () => {
  it('returns normalized results, source status, and installed state without installing', async () => {
    const tool = createSkillsMarketplaceSearchTool({
      getConfig: () => ConfigSchema.parse(undefined),
      getSkillManager: () => ({ findSkill: (name: string) => name === 'React Performance' ? {} : undefined }) as SkillManager,
      search: async () => ({
        sources: [
          { source: 'store', ok: true, count: 1 },
          { source: 'clawhub', ok: false, count: 0, error: 'timeout' },
        ],
        results: [{
          id: 'store:react-performance',
          provider: 'store',
          source: 'store',
          name: 'React Performance',
          description: 'Tune React rendering performance',
          author: 'xopc',
          downloads: 1200,
          stars: 40,
          updatedAt: '2026-08-01T00:00:00.000Z',
          canonicalUrl: null,
          install: { kind: 'store', reference: 'react-performance', sourceUrl: null },
          security: { status: 'unknown', scanners: [] },
          valueScore: 88,
        }],
      }),
    });

    const response = await tool.execute('call-1', { query: 'react performance', limit: 5 });
    const payload = JSON.parse(response.content[0]?.type === 'text' ? response.content[0].text : '{}');

    expect(payload).toMatchObject({
      success: true,
      scoreIsHeuristic: true,
      installationRequiresConfirmation: true,
    });
    expect(payload.sources[1]).toMatchObject({ ok: false, error: 'timeout' });
    expect(payload.results[0]).toMatchObject({
      source: 'store',
      installed: true,
      install: { reference: 'react-performance' },
    });
  });

  it('is read-only, parallel-safe, and idempotent', () => {
    const tool = createSkillsMarketplaceSearchTool({ getConfig: () => ConfigSchema.parse(undefined) });
    expect(getToolMetadata(tool)).toMatchObject({
      mutatesWorkspace: false,
      mutationScope: 'none',
      supportsParallel: true,
      idempotent: true,
    });
  });
});
