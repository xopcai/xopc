import {
  DEFAULT_HTML_SEARCH_TIMEOUT_MS,
  HTML_SEARCH_USER_AGENT,
  mergeAbortWithTimeout,
} from '../http.js';
import type { SearchProvider, SearchResult } from '../types.js';

const DDG_HTML = 'https://html.duckduckgo.com/html/';

/**
 * HTML scrape of DuckDuckGo — zero-config fallback outside China. Unofficial; may rate-limit.
 */
export class DuckDuckGoHtmlProvider implements SearchProvider {
  readonly name = 'duckduckgo-html';

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const body = new URLSearchParams();
    body.set('q', query);

    const merged = mergeAbortWithTimeout(signal, DEFAULT_HTML_SEARCH_TIMEOUT_MS);

    const response = await fetch(DDG_HTML, {
      method: 'POST',
      signal: merged,
      headers: {
        'User-Agent': HTML_SEARCH_USER_AGENT,
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseDdgHtml(html, count);
  }
}

/** Best-effort parse of DDG HTML SERP. */
export function parseDdgHtml(html: string, max: number): SearchResult[] {
  const out: SearchResult[] = [];
  const resultRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) !== null && out.length < max) {
    const url = decodeHtmlEntities(stripTags(m[1]).trim());
    const title = decodeHtmlEntities(stripTags(m[2]).trim());
    if (!url || !title || url.startsWith('/')) continue;
    const after = html.slice(m.index, m.index + 1200);
    const snip = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(after);
    const description = snip
      ? decodeHtmlEntities(stripTags(snip[1]).replace(/\s+/g, ' ').trim())
      : '';
    out.push({ title, url, description: description.slice(0, 500), source: 'duckduckgo-html' });
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
