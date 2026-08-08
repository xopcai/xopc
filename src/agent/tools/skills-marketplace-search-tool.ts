import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import type { SkillManager } from '../skills/skill-manager.js';
import {
  searchSkillMarketplaces,
  type SkillsMarketplaceSearchSource,
} from '../skills/marketplace/search.js';

const SkillsMarketplaceSearchSchema = Type.Object({
  query: Type.String({
    minLength: 2,
    description: 'Capability or task to search for, using concise English keywords when possible',
  }),
  sources: Type.Optional(Type.Array(
    Type.Union([Type.Literal('store'), Type.Literal('clawhub'), Type.Literal('skills-sh')]),
    { minItems: 1, maxItems: 3, uniqueItems: true },
  )),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
});

type SearchResponse = Awaited<ReturnType<typeof searchSkillMarketplaces>>;

export interface SkillsMarketplaceSearchToolDeps {
  getConfig: () => Config | undefined;
  getSkillManager?: () => SkillManager | undefined;
  search?: (params: {
    config: Config;
    query: string;
    sources?: SkillsMarketplaceSearchSource[];
    limit?: number;
  }) => Promise<SearchResponse>;
}

function jsonResult(payload: Record<string, unknown>): AgentToolResult<{}> {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], details: {} };
}

export function createSkillsMarketplaceSearchTool(
  deps: SkillsMarketplaceSearchToolDeps,
): AgentTool {
  return {
    name: 'skills_marketplace_search',
    label: '🔎 Find skills',
    description:
      'Search the XOPC Store, native ClawHub catalog, and skills.sh results federated by ClawHub. ' +
      'Returns normalized provenance, install references, adoption metrics, partial-source errors, and a heuristic value score. Read-only; never installs a skill.',
    parameters: SkillsMarketplaceSearchSchema,
    mutatesWorkspace: false,
    mutationScope: 'none',
    supportsParallel: true,
    idempotent: true,
    async execute(
      _toolCallId: string,
      params: Static<typeof SkillsMarketplaceSearchSchema>,
    ): Promise<AgentToolResult<{}>> {
      const config = deps.getConfig();
      if (!config) {
        return jsonResult({ success: false, error: 'XOPC config is not available in this runtime context.' });
      }

      const query = params.query.trim();
      if (query.length < 2) {
        return jsonResult({ success: false, error: 'query must contain at least 2 characters.' });
      }

      const search = deps.search ?? searchSkillMarketplaces;
      const response = await search({
        config,
        query,
        sources: params.sources,
        limit: params.limit,
      });
      const manager = deps.getSkillManager?.();
      const results = response.results.map((result) => ({
        ...result,
        installed: Boolean(manager?.findSkill(result.name)),
      }));

      return jsonResult({
        success: true,
        query,
        scoreIsHeuristic: true,
        sources: response.sources,
        results,
        installationRequiresConfirmation: true,
      });
    },
  } as AgentTool;
}
