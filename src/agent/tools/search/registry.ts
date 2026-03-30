import { createLogger } from '../../../utils/logger.js';
import type { ResolvedWebSearchConfig, SearchProvider, SearchResult } from './types.js';
import { BraveProvider } from './providers/brave.js';
import { TavilyProvider } from './providers/tavily.js';
import { BingApiProvider } from './providers/bing-api.js';
import { BingHtmlProvider } from './providers/bing-html.js';
import { DuckDuckGoHtmlProvider } from './providers/duckduckgo-html.js';
import { SearXNGProvider } from './providers/searxng.js';

const log = createLogger('web-search');

export class SearchProviderRegistry {
  private readonly providers: SearchProvider[];
  private readonly fallbackProvider: SearchProvider;

  constructor(config: ResolvedWebSearchConfig) {
    this.providers = this.buildProviders(config);
    this.fallbackProvider =
      config.region === 'cn' ? new BingHtmlProvider() : new DuckDuckGoHtmlProvider();
    log.debug(
      { region: config.region, configuredCount: this.providers.filter((p) => p.isAvailable()).length },
      'Web search registry ready',
    );
  }

  private buildProviders(config: ResolvedWebSearchConfig): SearchProvider[] {
    const list: SearchProvider[] = [];

    for (const p of config.providers) {
      if (p.disabled) continue;
      switch (p.type) {
        case 'brave':
          list.push(new BraveProvider(p.apiKey ?? ''));
          break;
        case 'tavily':
          list.push(new TavilyProvider(p.apiKey ?? ''));
          break;
        case 'bing':
          list.push(new BingApiProvider(p.apiKey ?? ''));
          break;
        case 'searxng':
          list.push(new SearXNGProvider(p.url ?? ''));
          break;
        default:
          break;
      }
    }

    return list;
  }

  hasConfiguredApiProvider(): boolean {
    return this.providers.some((p) => p.isAvailable());
  }

  async search(
    query: string,
    count: number,
    signal?: AbortSignal,
  ): Promise<{ results: SearchResult[]; provider: string }> {
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      try {
        const results = await provider.search(query, count, signal);
        return { results, provider: provider.name };
      } catch (err) {
        log.debug({ provider: provider.name, err }, 'Search provider failed, trying next');
      }
    }

    try {
      const results = await this.fallbackProvider.search(query, count, signal);
      return { results, provider: this.fallbackProvider.name };
    } catch (err) {
      log.warn({ err }, 'HTML fallback search failed');
      return { results: [], provider: 'none' };
    }
  }
}
