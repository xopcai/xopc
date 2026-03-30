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
  search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]>;
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
