import { AsyncLocalStorage } from 'node:async_hooks';
import type { SearchResult } from './types.js';

export const SEARCH_CACHE_TTL_MS = 10 * 60_000;
export interface SearchCacheEntry {
  key: string;
  query: string;
  count: number;
  results: SearchResult[];
  provider: string;
  capturedAt: number;
}
export interface SearchCache {
  get(key: string): SearchCacheEntry | undefined;
  set(entry: SearchCacheEntry): void;
}
const searchCache = new AsyncLocalStorage<SearchCache>();
/** Research owns this scope. No account-wide or cross-conversation cache exists. */
export function withSearchCache<T>(cache: SearchCache, run: () => T): T { return searchCache.run(cache, run); }
export function currentSearchCache(): SearchCache | undefined { return searchCache.getStore(); }

export class SearchCacheWriteError extends Error {
  constructor(cause: unknown) { super('Search completed but its checkpoint could not be saved', { cause }); this.name = 'SearchCacheWriteError'; }
}
