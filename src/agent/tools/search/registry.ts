import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createLogger } from '../../../utils/logger.js';
import { executeWithTimeout } from '../../lifecycle/timeout-wrapper.js';
import { classifySearchError, searchFailureInfo, SearchError } from './errors.js';
import { currentSearchCache, SEARCH_CACHE_TTL_MS, SearchCacheWriteError, type SearchCache } from './cache.js';
import type { ResolvedWebSearchConfig, SearchProvider, SearchResponse, SearchRequest, SearchBatchResponse } from './types.js';
import { BraveProvider } from './providers/brave.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { TavilyProvider } from './providers/tavily.js';
import { BingApiProvider } from './providers/bing-api.js';
import { BingHtmlProvider } from './providers/bing-html.js';
import { DuckDuckGoHtmlProvider } from './providers/duckduckgo-html.js';
import { SearXNGProvider } from './providers/searxng.js';
import { XopcCloudSearchProvider } from './providers/xopc-cloud.js';

const log = createLogger('Agent:WebSearch');

export class SearchProviderRegistry {
  private readonly providers: SearchProvider[];
  private readonly fallbackProvider: SearchProvider | null;
  private readonly cache: SearchCache;
  private readonly cachePrefix: string;
  private readonly requestTimeoutMs: number;
  private readonly cloudRequestTimeoutMs: number;
  private readonly retryDelayMs: number;
  sourceRequests = 0;
  private readonly cooldowns = new Map<string, { until: number; error: SearchError }>();

  constructor(config: ResolvedWebSearchConfig, options: { cloudProvider?: SearchProvider; providers?: SearchProvider[]; fallbackProvider?: SearchProvider | null; cache?: SearchCache; requestTimeoutMs?: number; retryDelayMs?: number } = {}) {
    this.providers = options.providers ?? this.buildProviders(config, options.cloudProvider);
    this.fallbackProvider = options.fallbackProvider === undefined
      ? config.region === 'cn' ? new BingHtmlProvider() : new DuckDuckGoHtmlProvider() : options.fallbackProvider;
    const cache = new Map<string, import('./cache.js').SearchCacheEntry>();
    this.cache = options.cache ?? currentSearchCache() ?? { get: key => cache.get(key), set: entry => {
      if (JSON.stringify(entry).length > 200_000) return;
      cache.delete(entry.key); cache.set(entry.key, entry);
      while (cache.size > 20) cache.delete(cache.keys().next().value!);
    } };
    this.cachePrefix = createHash('sha256').update(JSON.stringify([config, this.providers.map(provider => [provider.name, provider.cacheIdentity?.()]), this.fallbackProvider?.name])).digest('hex');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.cloudRequestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    log.debug(
      { region: config.region, configuredCount: this.providers.filter((p) => p.isAvailable()).length },
      'Web search registry ready',
    );
  }

  private buildProviders(
    config: ResolvedWebSearchConfig,
    cloudProvider?: SearchProvider,
  ): SearchProvider[] {
    const list: SearchProvider[] = [];
    const hasUsableManualProvider = config.providers.some((provider) => {
      if (provider.disabled) return false;
      return provider.type === 'searxng'
        ? Boolean(provider.url?.trim())
        : Boolean(provider.apiKey?.trim());
    });

    if (!hasUsableManualProvider) {
      list.push(cloudProvider ?? new XopcCloudSearchProvider({ region: config.region }));
    }

    for (const p of config.providers) {
      if (p.disabled) continue;
      switch (p.type) {
        case 'deepseek':
          list.push(new DeepSeekProvider(p.apiKey ?? '', p.url));
          break;
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

  private key(query: string, count: number): string {
    return createHash('sha256').update(JSON.stringify([this.cachePrefix, query.trim(), count])).digest('hex');
  }
  private cached(query: string, count: number): SearchResponse | undefined {
    const cached = this.cache.get(this.key(query, count));
    return cached && Date.now() >= cached.capturedAt && Date.now() - cached.capturedAt < SEARCH_CACHE_TTL_MS
      ? { results: structuredClone(cached.results), provider: cached.provider, cached: true, capturedAt: cached.capturedAt } : undefined;
  }
  private remember(query: string, count: number, response: SearchResponse): void {
    try { this.cache.set({ key: this.key(query, count), query: query.trim(), count, results: structuredClone(response.results), provider: response.provider, capturedAt: response.capturedAt ?? Date.now() }); }
    catch (error) { throw new SearchCacheWriteError(error); }
  }
  private async attempt<T>(name: string, signal: AbortSignal | undefined, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    this.sourceRequests++;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await executeWithTimeout(() => execute(controller.signal), { toolName: `web_search:${name}`,
        timeoutMs: name === 'xopc-cloud' ? this.cloudRequestTimeoutMs : this.requestTimeoutMs, signal, onTimeout: error => controller.abort(error) });
    } catch (error) { throw classifySearchError(error, signal); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  private async backoff(error: SearchError, signal?: AbortSignal): Promise<boolean> {
    const waitMs = error.retryAfterMs ?? this.retryDelayMs;
    // Do not silently ignore a long server cooldown or wait beyond the caller's deadline.
    if (waitMs > 2_000) return false;
    await delay(Math.max(0, waitMs), undefined, { signal });
    return true;
  }
  async search(query: string, count: number, signal?: AbortSignal, authorize: () => void = () => {}): Promise<SearchResponse> {
    signal?.throwIfAborted(); authorize();
    const hit = this.cached(query, count);
    if (hit) return hit;
    let lastError: SearchError | undefined;
    for (const provider of [...this.providers, ...(this.fallbackProvider ? [this.fallbackProvider] : [])]) {
      signal?.throwIfAborted(); authorize();
      if (!provider.isAvailable()) continue;
      const cooldown = this.cooldowns.get(provider.name);
      if (cooldown && cooldown.until > Date.now()) { lastError = cooldown.error; continue; }
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted(); authorize();
        try {
          const results = await this.attempt(provider.name, signal, requestSignal => provider.search(query, count, requestSignal));
          signal?.throwIfAborted(); authorize();
          const response = { results, provider: provider.name, capturedAt: Date.now() };
          this.remember(query, count, response);
          return response;
        } catch (error) {
          if (error instanceof SearchCacheWriteError) throw error;
          const failure = classifySearchError(error, signal);
          if (signal?.aborted || failure.kind === 'permission_denied' || failure.kind === 'cancelled') throw failure;
          lastError = failure;
          if (failure.kind === 'rate_limited') this.cooldowns.set(provider.name, { until: Date.now() + (failure.retryAfterMs ?? this.retryDelayMs), error: failure });
          log.debug({ provider: provider.name, kind: failure.kind, attempt }, 'Search provider attempt failed');
          if (attempt || !['rate_limited', 'timeout'].includes(failure.kind) || !await this.backoff(failure, signal)) break;
        }
      }
    }
    throw lastError ?? new SearchError({ kind: 'provider_error', scope: 'request', message: 'No search provider is available' });
  }

  /** Only unfinished, non-denied items degrade to sequential authorized searches. */
  async searchBatch(requests: SearchRequest[], signal?: AbortSignal, authorize: () => void = () => {}): Promise<SearchBatchResponse[]> {
    if (!requests.length || requests.length > 8 || new Set(requests.map(request => request.id)).size !== requests.length) throw new Error('Invalid search batch');
    signal?.throwIfAborted(); authorize();
    const outputs = new Map<string, SearchBatchResponse>();
    const unique = new Map<string, SearchRequest>();
    for (const request of requests) {
      const hit = this.cached(request.query, request.count);
      if (hit) outputs.set(this.key(request.query, request.count), { ...request, response: hit });
      else unique.set(this.key(request.query, request.count), request);
    }
    const pending = [...unique.values()];
    const provider = this.providers.find(provider => provider.isAvailable() && (this.cooldowns.get(provider.name)?.until ?? 0) <= Date.now());
    const itemFailures = new Map<string, SearchError>();
    if (pending.length > 1 && provider?.searchBatch) {
      try {
        authorize();
        const items = await this.attempt(provider.name, signal, requestSignal => provider.searchBatch!(pending, requestSignal));
        const ids = new Set(pending.map(request => request.id));
        if (items.some(item => !ids.has(item.id)) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Invalid batch search response ids');
        signal?.throwIfAborted(); authorize();
        let providerRefusal: SearchError | undefined;
        for (const request of pending) {
          const item = items.find(item => item.id === request.id);
          if (item?.results && !item.error) {
            const response = { results: item.results, provider: provider.name, capturedAt: Date.now() };
            this.remember(request.query, request.count, response);
            outputs.set(this.key(request.query, request.count), { ...request, response });
          } else if (item?.error) {
            if (item.error.kind === 'permission_denied' && item.error.scope === 'provider') providerRefusal = new SearchError(item.error);
            if (['permission_denied', 'cancelled'].includes(item.error.kind) && item.error.scope !== 'batch') {
              outputs.set(this.key(request.query, request.count), { ...request, error: item.error });
            } else {
              const failure = new SearchError(item.error);
              itemFailures.set(this.key(request.query, request.count), failure);
              if (failure.kind === 'rate_limited') this.cooldowns.set(provider.name, { until: Date.now() + (failure.retryAfterMs ?? this.retryDelayMs), error: failure });
            }
          }
        }
        if (providerRefusal) for (const request of pending) {
          const key = this.key(request.query, request.count);
          if (!outputs.has(key)) outputs.set(key, { ...request, error: searchFailureInfo(providerRefusal) });
        }
      } catch (error) {
        if (error instanceof SearchCacheWriteError) throw error;
        const batchFailure = classifySearchError(error, signal);
        if (signal?.aborted || (batchFailure.kind === 'permission_denied' && batchFailure.scope !== 'batch') || batchFailure.kind === 'cancelled') {
          for (const request of pending) outputs.set(this.key(request.query, request.count), { ...request, error: searchFailureInfo(batchFailure) });
        } else if (batchFailure.kind === 'rate_limited') {
          this.cooldowns.set(provider!.name, { until: Date.now() + (batchFailure.retryAfterMs ?? this.retryDelayMs), error: batchFailure });
          if (!await this.backoff(batchFailure, signal)) {
            for (const request of pending) outputs.set(this.key(request.query, request.count), { ...request, error: searchFailureInfo(batchFailure) });
          }
        }
      }
    }
    // Providers without an advertised batch implementation use singles directly.
    for (const request of pending) {
      const key = this.key(request.query, request.count);
      if (outputs.has(key)) continue;
      try {
        const itemFailure = itemFailures.get(key);
        if (itemFailure?.kind === 'rate_limited' && !await this.backoff(itemFailure, signal)) {
          outputs.set(key, { ...request, error: searchFailureInfo(itemFailure) });
          continue;
        }
        const response = await this.search(request.query, request.count, signal, authorize);
        outputs.set(key, { ...request, response, ...(provider?.searchBatch ? { fallback: 'individual' as const } : {}) });
      } catch (error) {
        const failure = classifySearchError(error, signal);
        outputs.set(key, { ...request, error: searchFailureInfo(failure), ...(provider?.searchBatch ? { fallback: 'individual' as const } : {}) });
        if (failure.kind === 'permission_denied' && failure.scope === 'provider') for (const remaining of pending) {
          const remainingKey = this.key(remaining.query, remaining.count);
          if (!outputs.has(remainingKey)) outputs.set(remainingKey, { ...remaining, error: searchFailureInfo(failure) });
        }
      }
    }
    return requests.map(request => ({ ...outputs.get(this.key(request.query, request.count))!, ...request }));
  }
}
