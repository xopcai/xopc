import {
  DEFAULT_HTML_SEARCH_TIMEOUT_MS,
  HTML_SEARCH_USER_AGENT,
  mergeAbortWithTimeout,
} from '../http.js';
import type { SearchProvider, SearchResult } from '../types.js';

const BING_CN_SEARCH = 'https://cn.bing.com/search';

/**
 * HTML scrape of cn.bing.com — zero-config fallback for China. May break if markup changes; subject to ToS.
 */
export class BingHtmlProvider implements SearchProvider {
  readonly name = 'bing-html';

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = new URL(BING_CN_SEARCH);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(count, 15)));

    const merged = mergeAbortWithTimeout(signal, DEFAULT_HTML_SEARCH_TIMEOUT_MS);

    const response = await fetch(url.toString(), {
      signal: merged,
      headers: {
        'User-Agent': HTML_SEARCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseBingCnHtml(html, count);
  }
}

/** Best-effort parse of Bing CN SERP (b_algo blocks). */
export function parseBingCnHtml(html: string, max: number): SearchResult[] {
  const out: SearchResult[] = [];
  const liRe = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null && out.length < max) {
    const block = m[1];
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = decodeHtmlEntities(stripTags(link[1]).trim());
    const title = decodeHtmlEntities(stripTags(link[2]).trim());
    const cap = /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const desc = cap ? decodeHtmlEntities(stripTags(cap[1]).replace(/\s+/g, ' ').trim()) : '';
    if (url && title) {
      out.push({ title, url, description: desc.slice(0, 500), source: 'bing-html' });
    }
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
