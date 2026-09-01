// Memory search tools for xopc agent
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { MemoryManager } from '../memory/manager.js';
import type { MemoryScope } from '../memory/types.js';

// =============================================================================
// Memory Search Tool
// =============================================================================
const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

type MemorySearchParams = { query: string; maxResults?: number; minScore?: number };

export interface MemoryToolOptions {
  getMemoryManager: () => MemoryManager;
  getScope?: () => Partial<MemoryScope>;
}

export function createMemorySearchTool(options: MemoryToolOptions): AgentTool {
  const { getMemoryManager } = options;
  return {
    name: 'memory_search',
    label: '🔍 Memory Search',
    description:
      'Search workspace and connected-source memory records for prior work, decisions, dates, people, or todos; returns ranked snippets with stable record ids.',
    parameters: MemorySearchSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const { query, maxResults, minScore } = params as MemorySearchParams;

      try {
        const results = await getMemoryManager().search({
          query,
          maxResults,
          minScore,
          scope: options.getScope?.(),
        });
        for (const result of results) {
          getMemoryManager().recordSignal({
            source: 'search_recall',
            recordId: result.record.id,
            score: result.score,
            content: result.snippet,
            metadata: {
              providerId: result.citation.providerId,
              query,
            },
          });
        }
        const withCitations = results.map((entry) => ({
          id: entry.record.id,
          ownerAgentId: entry.record.provenance?.sourceAgentId,
          originClass: entry.record.provenance?.originClass ?? 'untrusted',
          sessionKind: entry.record.provenance?.sessionKind ?? 'unknown',
          derivedFromRecalledContext: entry.record.provenance?.derivedFromRecalledContext ?? true,
          trustedForAutomaticRecall:
            (entry.record.provenance?.originClass === 'owner'
              || entry.record.provenance?.originClass === 'agent')
            && entry.record.provenance?.derivedFromRecalledContext === false,
          kind: entry.record.kind,
          content: entry.snippet,
          score: entry.score,
          citation: entry.record.id,
          snippet: `${entry.snippet.trim()}\n\nMemory record: ${entry.record.id}`,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify({ results: withCitations, provider: 'memory-manager' }, null, 2) }],
          details: { results: withCitations },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Search error: ${message}` }],
          details: { error: message },
        };
      }
    },
  } as any;
}

// =============================================================================
// Memory Get Tool
// =============================================================================
const MemoryGetSchema = Type.Object({
  id: Type.String(),
});

type MemoryGetParams = { id: string };

export function createMemoryGetTool(options: MemoryToolOptions): AgentTool {
  const { getMemoryManager } = options;
  return {
    name: 'memory_get',
    label: '📄 Memory Get',
    description: 'Read one structured memory record by an id returned from memory_search.',
    parameters: MemoryGetSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const { id } = params as MemoryGetParams;

      try {
        const result = await getMemoryManager().read({
          id,
          scope: options.getScope?.(),
        });
        if (!result) {
          return {
            content: [{ type: 'text', text: `Memory record not found: ${id}` }],
            details: { id, text: '' },
          };
        }
        return {
          content: [{ type: 'text', text: result.record.content }],
          details: { id, record: result.record },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Read error: ${message}` }],
          details: { error: message },
        };
      }
    },
  } as any;
}
