// Web search and fetch tools
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { classifySearchError, searchFailureInfo, SearchError } from './search/errors.js';
import type { SearchRequest, SearchResponse } from './search/types.js';
import { SearchProviderRegistry } from './search/registry.js';
import { resolveWebSearchConfig } from './search/resolve-config.js';
import { fetchPublicText } from './fetch-text.js';

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
export interface WebSearchBatchTool extends AgentTool {
  executeSearchBatch(requests: Array<{ id: string; query: string; count?: number }>, signal?: AbortSignal,
    authorize?: () => void): Promise<{ items: Array<{ id: string; result: AgentToolResult<any> }>; sourceRequests: number }>;
}
function searchToolResult(query: string, count: number, response: SearchResponse): AgentToolResult<any> {
  return { content: [{ type: 'text', text: response.results.length ? formatSearchResults(response.results) : 'No results found.' }],
    details: { results: response.results, provider: response.provider, query, count, cached: response.cached ?? false, capturedAt: response.capturedAt } };
}
function searchToolError(error: unknown, signal?: AbortSignal): AgentToolResult<any> {
  const failure = classifySearchError(error, signal);
  return { content: [{ type: 'text', text: `Search error (${failure.kind}): ${failure.message}` }],
    details: { results: [], error: failure.message, failure: searchFailureInfo(failure), status: failure.kind === 'cancelled' ? 'cancelled' : 'failed' } };
}
export function createWebSearchTool(getConfig: () => Config | undefined): WebSearchBatchTool {
  return {
    name: 'web_search',
    description: 'Search the web using authorized configured providers or the region-aware HTML fallback. Search failures retain permission, rate-limit and timeout reasons. Research reuses recent successful queries; permission refusals are not bypassed.',
    parameters: WebSearchSchema, label: '🔍 Web Search', supportsParallel: true,
    async execute(_id: string, params: WebSearchParams, signal?: AbortSignal): Promise<AgentToolResult<any>> {
      const cfg = resolveWebSearchConfig(getConfig()?.tools?.web);
      const registry = new SearchProviderRegistry(cfg);
      const count = Math.max(1, Math.min(20, Math.floor(params.count ?? cfg.maxResults ?? 5)));
      try {
        const response = await registry.search(params.query, count, signal);
        const result = searchToolResult(params.query, count, response);
        return { ...result, details: { ...result.details, sourceRequests: registry.sourceRequests } };
      } catch (error) {
        const result = searchToolError(error, signal);
        return { ...result, details: { ...result.details, sourceRequests: registry.sourceRequests } };
      }
    },
    // Host-only optimization: data_batch already exposes every individual read to approval policies.
    async executeSearchBatch(requests, signal, authorize = () => {}) {
      const cfg = resolveWebSearchConfig(getConfig()?.tools?.web);
      const registry = new SearchProviderRegistry(cfg);
      const inputs: SearchRequest[] = requests.map(request => ({ ...request,
        count: Math.max(1, Math.min(20, Math.floor(request.count ?? cfg.maxResults ?? 5))),
      }));
      const responses = await registry.searchBatch(inputs, signal, authorize);
      return { sourceRequests: registry.sourceRequests, items: responses.map(item => {
        const result = item.response ? searchToolResult(item.query, item.count, item.response) : searchToolError(new SearchError(item.error!), signal);
        return { id: item.id, result: { ...result, details: { ...result.details, fallback: item.fallback } } };
      }) };
    },
  } as WebSearchBatchTool;
}

// =============================================================================
// Web Fetch Tool
// =============================================================================
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

export async function extractReadableText(html: string, pageUrl: string): Promise<string> {
  const { parseHTML } = await import('linkedom');
  const { Readability } = await import('@mozilla/readability');
  const { document } = parseHTML(html);
  const main = document.querySelector('main, [role="main"]');
  const paragraphs = [...(main?.querySelectorAll('p') ?? [])]
    .filter(element => !element.closest('nav, aside, footer, header'))
    .map(element => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(text => text.length >= 40 && text.length <= 2000);
  Object.defineProperty(document, 'documentURI', { value: pageUrl });
  const reader = new Readability(document);
  const article = reader.parse();
  const text = article?.textContent?.trim() ?? '';
  // Readability can discard a short definition before longer reference sections. Preserve missing semantic main paragraphs.
  const normalized = text.replace(/\s+/g, ' ');
  const missing = [...new Set(paragraphs)].filter(paragraph => !normalized.includes(paragraph));
  return [...missing, text].filter(Boolean).join('\n\n');
}

type WebFetchParams = { url: string; maxChars?: number };

export function createWebFetchTool(getConfig: () => Config | undefined): AgentTool {
  return {
    name: 'web_fetch',
    description: 'Fetch and extract readable content from a URL (HTML via Readability; plain text as-is).',
    parameters: WebFetchSchema,
    label: '🌐 Web Fetch',
    supportsParallel: true,

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      try {
        const p = params as WebFetchParams;

        const fetched = await fetchPublicText(p.url, getConfig()?.tools?.web?.blocklist, signal);
        const html = fetched.text;
        const maxChars = p.maxChars || 10000;
        const contentType = fetched.contentType;
        const looksHtml =
          /html|xml/i.test(contentType) || /^[\s\n]*</.test(html.slice(0, Math.min(500, html.length)));

        let text: string;
        if (looksHtml) {
          try {
            text = await extractReadableText(html, fetched.url);
            if (!text || text.length < 40) {
              text = stripHtmlFallback(html);
            }
          } catch {
            text = stripHtmlFallback(html);
          }
        } else {
          text = html.trim();
        }

        const truncated = text.length > maxChars;
        if (truncated) {
          text = text.substring(0, maxChars) + '\n\n[truncated...]';
        }

        return {
          content: [{ type: 'text', text }],
          details: { truncated, complete: !truncated, url: fetched.url },
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Fetch error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  } as any;
}
