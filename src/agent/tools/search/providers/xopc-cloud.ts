import { getModelCatalogStore, type ModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { getProviderAuthService, type ProviderAuthService } from '../../../../providers/provider-auth-service.js';
import type { SearchProvider, SearchResult } from '../types.js';

interface XopcCloudSearchProviderOptions {
  region: 'cn' | 'global';
  fetchImpl?: typeof fetch;
  catalogStore?: Pick<ModelCatalogStore, 'getSource'>;
  credentials?: Pick<ProviderAuthService, 'resolveApiKey'>;
}

export class XopcCloudSearchProvider implements SearchProvider {
  readonly name = 'xopc-cloud';
  private readonly fetchImpl: typeof fetch;
  private readonly catalogStore: Pick<ModelCatalogStore, 'getSource'>;
  private readonly credentials: Pick<ProviderAuthService, 'resolveApiKey'>;

  constructor(private readonly options: XopcCloudSearchProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.catalogStore = options.catalogStore ?? getModelCatalogStore();
    this.credentials = options.credentials ?? getProviderAuthService();
  }

  isAvailable(): boolean {
    return Boolean(this.catalogStore.getSource('xopc-cloud')?.search);
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const source = this.catalogStore.getSource('xopc-cloud');
    if (!source?.search) throw new Error('XOPC Cloud search is not available');
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud', requestSignal);
    if (!accessToken) throw new Error('XOPC Cloud is not connected');
    const endpoint = `${source.baseUrl.replace(/\/+$/, '')}/${source.search.endpoint.replace(/^\/+/, '')}`;
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        count: Math.max(1, Math.min(count, source.search.maxResults)),
        region: this.options.region,
      }),
      signal: requestSignal,
    });
    const body = await response.json().catch(() => null) as {
      results?: Array<{ title?: unknown; url?: unknown; description?: unknown }>;
      error?: { message?: unknown };
    } | null;
    if (!response.ok) {
      throw new Error(
        typeof body?.error?.message === 'string'
          ? body.error.message
          : `XOPC Cloud search failed (${response.status})`,
      );
    }
    if (!Array.isArray(body?.results)) throw new Error('XOPC Cloud search returned an invalid response');
    return body.results.flatMap((result) => {
      if (
        typeof result.title !== 'string'
        || typeof result.url !== 'string'
        || typeof result.description !== 'string'
      ) return [];
      return [{
        title: result.title,
        url: result.url,
        description: result.description,
        source: this.name,
      }];
    });
  }
}
