import { describe, expect, it } from 'vitest';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { extractSearchSources } from '@/features/chat/tool-results/search-source-utils';

function completedTool(name: string, result: unknown): ToolUseContent {
  return { type: 'tool_use', id: name, name, status: 'done', result };
}

describe('extractSearchSources', () => {
  it('extracts sources only from web-search tools', () => {
    const sources = extractSearchSources([
      completedTool('memory_search', JSON.stringify({
        results: [{ title: 'Memory record', url: 'https://example.com/memory' }],
      })),
      completedTool('codebase-memory-mcp__search_graph', JSON.stringify({
        results: [{ title: 'Code node', url: 'https://example.com/code' }],
      })),
      completedTool('search-provider__web_search', JSON.stringify({
        results: [{ title: 'Web result', url: 'https://example.com/web' }],
      })),
    ]);

    expect(sources).toEqual([
      { title: 'Web result', url: 'https://example.com/web', snippet: undefined },
    ]);
  });
});
