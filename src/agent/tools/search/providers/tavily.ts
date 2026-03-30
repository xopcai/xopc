import type { SearchProvider, SearchResult } from '../types.js';

export class TavilyProvider implements SearchProvider {
  readonly name = 'tavily';

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.isAvailable()) {
      throw new Error('Tavily API key not configured');
    }
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: count,
        search_depth: 'basic',
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const raw = data.results ?? [];
    return raw.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: truncateDesc(r.content),
      source: this.name,
    }));
  }
}

function truncateDesc(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= 400) return s;
  return `${s.slice(0, 400)}…`;
}
