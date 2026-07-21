// Memory search tools for xopc agent
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { recordDreamingRecalls } from '../memory/dreaming/short-term-store.js';
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
  workspaceDir: string;
  dreamingRoot: string;
  getMemoryManager: () => MemoryManager;
  getScope?: () => Partial<MemoryScope>;
  shouldRecordDreamingRecalls?: () => boolean;
}

export function createMemorySearchTool(options: MemoryToolOptions): AgentTool {
  const { dreamingRoot, getMemoryManager } = options;
  return {
    name: 'memory_search',
    label: '🔍 Memory Search',
    description:
      'Mandatory recall step: search indexed profile, curated, and session memory sources before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with source path + lines.',
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
              path: result.citation.path,
              lineStart: result.citation.lineStart,
              lineEnd: result.citation.lineEnd,
            },
          });
        }
        // Dreaming: record short-term recall evidence from memory_search.
        if (options.shouldRecordDreamingRecalls?.() !== false) {
          void recordDreamingRecalls({
            dreamingRoot,
            query,
            matches: results.map((entry) => ({
              file: entry.citation.path ?? entry.record.source.path ?? entry.record.id,
              lines: entry.snippet,
              score: entry.score,
              lineNumbers:
                entry.citation.lineStart != null
                  ? [entry.citation.lineStart, entry.citation.lineEnd ?? entry.citation.lineStart]
                  : [],
            })),
          }).catch(() => {});
        }
        const withCitations = results.map((entry) => ({
          id: entry.record.id,
          ownerAgentId: entry.record.provenance.sourceAgentId,
          kind: entry.record.kind,
          file: entry.citation.path ?? entry.record.source.path,
          lines: entry.snippet,
          score: entry.score,
          lineNumbers:
            entry.citation.lineStart != null
              ? [entry.citation.lineStart, entry.citation.lineEnd ?? entry.citation.lineStart]
              : [],
          citation: `${entry.citation.path ?? entry.record.id}${entry.citation.lineStart != null ? `#L${entry.citation.lineStart}${entry.citation.lineEnd && entry.citation.lineEnd !== entry.citation.lineStart ? `-L${entry.citation.lineEnd}` : ''}` : ''}`,
          snippet: `${entry.snippet.trim()}\n\nSource: ${entry.citation.path ?? entry.record.id}${entry.citation.lineStart != null ? `#L${entry.citation.lineStart}${entry.citation.lineEnd && entry.citation.lineEnd !== entry.citation.lineStart ? `-L${entry.citation.lineEnd}` : ''}` : ''}`,
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
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

type MemoryGetParams = { path: string; from?: number; lines?: number };

export function createMemoryGetTool(options: MemoryToolOptions): AgentTool {
  const { getMemoryManager } = options;
  return {
    name: 'memory_get',
    label: '📄 Memory Get',
    description: 'Safe snippet read from a source path returned by memory_search, with optional from/lines; pull only the needed lines and keep context small.',
    parameters: MemoryGetSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const { path, from, lines } = params as MemoryGetParams;

      try {
        const result = await getMemoryManager().read({
          path,
          from,
          lines,
          scope: options.getScope?.(),
        });
        if (!result) {
          return {
            content: [{ type: 'text', text: `File not found: ${path}` }],
            details: { path, text: '' },
          };
        }
        return {
          content: [{ type: 'text', text: result.record.content }],
          details: { path, text: result.record.content, lineNumbers: result.lineNumbers },
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
