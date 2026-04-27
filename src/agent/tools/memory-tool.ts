// Memory search tools for xopc agent
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { memorySearch, memoryGet } from '../prompt/memory/index.js';

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
  /** Agent home curated memories dir, e.g. ~/.xopc/agents/<id>/memories/ */
  memoriesDir?: string;
}

export function createMemorySearchTool(options: MemoryToolOptions): AgentTool {
  const { workspaceDir, memoriesDir } = options;
  return {
    name: 'memory_search',
    label: '🔍 Memory Search',
    description:
      'Mandatory recall step: semantically search bootstrap MEMORY.md, agent-home `memories/*.md`, and workspace `memory/*.md` before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.',
    parameters: MemorySearchSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const { query, maxResults, minScore } = params as MemorySearchParams;

      try {
        const results = await memorySearch(workspaceDir, query, { maxResults, minScore, memoriesDir });
        const withCitations = results.map((entry) => ({
          ...entry,
          citation: `${entry.file}#L${entry.lineNumbers[0]}${entry.lineNumbers.length > 1 ? `-L${entry.lineNumbers[entry.lineNumbers.length - 1]}` : ''}`,
          snippet: `${entry.lines.trim()}\n\nSource: ${entry.file}#L${entry.lineNumbers[0]}${entry.lineNumbers.length > 1 ? `-L${entry.lineNumbers[entry.lineNumbers.length - 1]}` : ''}`,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify({ results: withCitations, provider: 'simple' }, null, 2) }],
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
  const { workspaceDir, memoriesDir } = options;
  return {
    name: 'memory_get',
    label: '📄 Memory Get',
    description: 'Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.',
    parameters: MemoryGetSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const { path, from, lines } = params as MemoryGetParams;

      try {
        const result = memoryGet(workspaceDir, path, from, lines, memoriesDir);
        if (!result) {
          return {
            content: [{ type: 'text', text: `File not found: ${path}` }],
            details: { path, text: '' },
          };
        }
        return {
          content: [{ type: 'text', text: result.content }],
          details: { path, text: result.content, lineNumbers: result.lineNumbers },
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
