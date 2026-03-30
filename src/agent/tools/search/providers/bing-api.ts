import type { SearchProvider, SearchResult } from '../types.js';

/** Azure Bing Web Search API (global endpoint; works without a proxy from many regions). */
export class BingApiProvider implements SearchProvider {
  readonly name = 'bing-api';

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.isAvailable()) {
      throw new Error('Bing Search API key not configured');
    }
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(count, 50)));
    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
    };
    const raw = data.webPages?.value ?? [];
    return raw.map((r) => ({
      title: r.name ?? '',
      url: r.url ?? '',
      description: truncateDesc(r.snippet),
      source: this.name,
    }));
  }
}

function truncateDesc(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= 400) return s;
  return `${s.slice(0, 400)}…`;
}
