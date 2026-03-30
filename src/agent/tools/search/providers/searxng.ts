import type { SearchProvider, SearchResult } from '../types.js';

export class SearXNGProvider implements SearchProvider {
  readonly name = 'searxng';

  constructor(private readonly baseUrl: string) {}

  isAvailable(): boolean {
    return this.baseUrl.length > 0;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.isAvailable()) {
      throw new Error('SearXNG base URL not configured');
    }
    const url = new URL('search', ensureTrailingSlashOrigin(this.baseUrl));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'general');
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const raw = (data.results ?? []).slice(0, count);
    return raw.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: truncateDesc(r.content),
      source: this.name,
    }));
  }
}

function ensureTrailingSlashOrigin(base: string): string {
  try {
    const u = new URL(base);
    return u.toString().replace(/\/?$/, '/');
  } catch {
    return base.endsWith('/') ? base : `${base}/`;
  }
}

function truncateDesc(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= 400) return s;
  return `${s.slice(0, 400)}…`;
}
