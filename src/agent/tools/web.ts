// Web search and fetch tools
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

// =============================================================================
// Web Search Tool
// =============================================================================
const WebSearchSchema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(Type.Number({ description: 'Number of results (default: 5)' })),
});

export function createWebSearchTool(apiKey?: string): AgentTool<typeof WebSearchSchema, { results: any[] } > {
  return {
    name: 'web_search',
    description: 'Search the web using Brave Search API.',
    parameters: WebSearchSchema,
    label: '🔍 Web Search',

    async execute(
      toolCallId: string,
      params: Static<typeof WebSearchSchema>,
      signal?: AbortSignal
    ): Promise<AgentToolResult<{ results: any[] }>> {
      if (!apiKey) {
        return {
          content: [{ type: 'text', text: 'Error: Brave Search API key not configured' }],
          details: { results: [] },
        };
      }

      try {
        const count = params.count || 5;
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(params.query)}&count=${count}`;

        const response = await fetch(url, {
          headers: {
            'X-Subscription-Token': apiKey,
            'Accept': 'application/json',
          },
          signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as { web?: { results?: any[] } };
        const results = data.web?.results || [];

        const formatted = results
          .map(
            (r: any, i: number) =>
              `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description?.substring(0, 200)}...`
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: formatted || 'No results found' }],
          details: { results },
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Search error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { results: [] },
        };
      }
    },
  };
}

// =============================================================================
// Web Fetch Tool
// =============================================================================
const WebFetchSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch' }),
  maxChars: Type.Optional(Type.Number({ description: 'Maximum characters to return (default: 10000)' })),
});

export const webFetchTool: AgentTool<typeof WebFetchSchema, {} > = {
  name: 'web_fetch',
  description: 'Fetch and extract readable content from a URL.',
  parameters: WebFetchSchema,
  label: '🌐 Web Fetch',

  async execute(
    toolCallId: string,
    params: Static<typeof WebFetchSchema>,
    signal?: AbortSignal
  ): Promise<AgentToolResult<{}>> {
    try {
      const response = await fetch(params.url, { signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const maxChars = params.maxChars || 10000;

      // Simple HTML to text conversion
      let text = html
        .replace(/<script[^\u003e]*\u003e[\s\S]*?\u003c\/script\u003e/gi, '')
        .replace(/<style[^\u003e]*\u003e[\s\S]*?\u003c\/style\u003e/gi, '')
        .replace(/\u003c[^\u003e]+\u003e/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > maxChars) {
        text = text.substring(0, maxChars) + '\n\n[truncated...]';
      }

      return {
        content: [{ type: 'text', text }],
        details: {},
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Fetch error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  },
};
