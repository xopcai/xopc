// Memory search tools for xopcbot agent
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { memorySearch, memoryGet } from '../prompt/memory/index.js';

// =============================================================================
// Memory Search Tool
// =============================================================================
const MemorySearchSchema = Type.Object({
  query: Type.String({ description: 'Search query for memory files' }),
  maxResults: Type.Optional(Type.Number({ description: 'Maximum results to return' })),
  minScore: Type.Optional(Type.Number({ description: 'Minimum match score' })),
});

export function createMemorySearchTool(workspaceDir: string): AgentTool<typeof MemorySearchSchema, {}> {
  return {
    name: 'memory_search',
    label: '🔍 Memory Search',
    description: 'Search MEMORY.md and memory/*.md files for relevant context.',
    parameters: MemorySearchSchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof MemorySearchSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const { query, maxResults } = params;

      try {
        const results = await memorySearch(workspaceDir, query, { maxResults });
        const withCitations = results.map(entry => ({
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
  };
}

// =============================================================================
// Memory Get Tool
// =============================================================================
const MemoryGetSchema = Type.Object({
  path: Type.String({ description: 'File path (e.g., MEMORY.md or memory/2024-01-15.md)' }),
  from: Type.Optional(Type.Number({ description: 'Starting line number (1-indexed)' })),
  lines: Type.Optional(Type.Number({ description: 'Number of lines to read' })),
});

export function createMemoryGetTool(workspaceDir: string): AgentTool<typeof MemoryGetSchema, {}> {
  return {
    name: 'memory_get',
    label: '📄 Memory Get',
    description: 'Read a specific snippet from memory files.',
    parameters: MemoryGetSchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof MemoryGetSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const { path, from, lines } = params;

      try {
        const result = memoryGet(workspaceDir, path, from, lines);
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
  };
}
