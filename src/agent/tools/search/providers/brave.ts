import type { SearchProvider, SearchResult } from '../types.js';

export class BraveProvider implements SearchProvider {
  readonly name = 'brave';

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.isAvailable()) {
      throw new Error('Brave Search API key not configured');
    }
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const response = await fetch(url, {
      headers: {
        'X-Subscription-Token': this.apiKey,
        Accept: 'application/json',
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const raw = data.web?.results ?? [];
    return raw.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: truncateDesc(r.description),
      source: this.name,
    }));
  }
}

function truncateDesc(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= 400) return s;
  return `${s.slice(0, 400)}…`;
}
