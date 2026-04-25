// Web search and fetch tools
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { SearchProviderRegistry } from './search/registry.js';
import { resolveWebSearchConfig } from './search/resolve-config.js';

// =============================================================================
// Web Search Tool
// =============================================================================
const WebSearchSchema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(Type.Number({ description: 'Number of results (default: from config, usually 5)' })),
});

function formatSearchResults(
  results: Array<{ title: string; url: string; description: string }>,
): string {
  return results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ? `${r.description}` : ''}`,
    )
    .join('\n\n');
}

type WebSearchParams = { query: string; count?: number };

export function createWebSearchTool(getConfig: () => Config | undefined): AgentTool {
  return {
    name: 'web_search',
    description:
      'Search the web. Uses configured search APIs when set; otherwise falls back to a built-in HTML search (region-aware).',
    parameters: WebSearchSchema,
    label: '🔍 Web Search',

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ results: unknown[]; provider?: string }>> {
      const p = params as WebSearchParams;
      const cfg = resolveWebSearchConfig(getConfig()?.tools?.web);
      const registry = new SearchProviderRegistry(cfg);
      const count = p.count ?? cfg.maxResults ?? 5;

      try {
        const { results, provider } = await registry.search(p.query, count, signal);

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No results found.' }],
            details: { results: [], provider },
          };
        }

        const formatted = formatSearchResults(results);
        return {
          content: [{ type: 'text', text: formatted }],
          details: { results, provider },
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
  } as any;
}

// =============================================================================
// Web Fetch Tool
// =============================================================================
const MAX_FETCH_CHARS = 6_000_000;

const WebFetchSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch' }),
  maxChars: Type.Optional(Type.Number({ description: 'Maximum characters to return (default: 10000)' })),
});

function stripHtmlFallback(html: string): string {
  return html
    .replace(/<script[^\u003e]*\u003e[\s\S]*?\u003c\/script\u003e/gi, '')
    .replace(/<style[^\u003e]*\u003e[\s\S]*?\u003c\/style\u003e/gi, '')
    .replace(/\u003c[^\u003e]+\u003e/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractReadableText(html: string, pageUrl: string): Promise<string> {
  const { JSDOM } = await import('jsdom');
  const { Readability } = await import('@mozilla/readability');
  const dom = new JSDOM(html, { url: pageUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const text = article?.textContent?.trim() ?? '';
  return text;
}

type WebFetchParams = { url: string; maxChars?: number };

export const webFetchTool: AgentTool = {
  name: 'web_fetch',
  description: 'Fetch and extract readable content from a URL (HTML via Readability; plain text as-is).',
  parameters: WebFetchSchema,
  label: '🌐 Web Fetch',

  async execute(
    _toolCallId: string,
    params: any,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<{}>> {
    try {
      const p = params as WebFetchParams;
      const response = await fetch(p.url, { signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      if (html.length > MAX_FETCH_CHARS) {
        throw new Error('Response too large');
      }
      const maxChars = p.maxChars || 10000;
      const contentType = response.headers.get('content-type') ?? '';
      const looksHtml =
        /html|xml/i.test(contentType) || /^[\s\n]*</.test(html.slice(0, Math.min(500, html.length)));

      let text: string;
      if (looksHtml) {
        try {
          text = await extractReadableText(html, p.url);
          if (!text || text.length < 40) {
            text = stripHtmlFallback(html);
          }
        } catch {
          text = stripHtmlFallback(html);
        }
      } else {
        text = html.trim();
      }

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
} as any;
