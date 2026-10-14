import type { SearchFailureInfo } from './errors.js';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  /** Source provider id for transparency */
  source?: string;
}

export interface SearchProvider {
  name: string;
  isAvailable(): boolean;
  cacheIdentity?(): string;
  search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]>;
  /** Optional host-implemented batch transport; ids must be echoed for partial results. */
  searchBatch?(requests: SearchRequest[], signal?: AbortSignal): Promise<SearchBatchItem[]>;
}

export interface ResolvedSearchProviderEntry {
  type: 'brave' | 'tavily' | 'bing' | 'searxng';
  apiKey?: string;
  url?: string;
  disabled?: boolean;
}

/** Normalized input for SearchProviderRegistry (after resolveConfigValue on keys) */
export interface ResolvedWebSearchConfig {
  region: 'cn' | 'global';
  maxResults: number;
  providers: ResolvedSearchProviderEntry[];
}

export interface SearchRequest { id: string; query: string; count: number }
export interface SearchBatchItem {
  id: string;
  results?: SearchResult[];
  error?: SearchFailureInfo;
}
export interface SearchResponse {
  results: SearchResult[];
  provider: string;
  cached?: boolean;
  capturedAt?: number;
}
export interface SearchBatchResponse extends SearchRequest {
  response?: SearchResponse;
  error?: SearchFailureInfo;
  fallback?: 'individual';
}
