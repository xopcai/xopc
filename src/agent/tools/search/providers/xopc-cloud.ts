import { searchHttpError } from '../errors.js';
import { getModelCatalogStore, type ModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { getProviderAuthService, type ProviderAuthService } from '../../../../providers/provider-auth-service.js';
import type { SearchExecution, SearchProvider, SearchResult } from '../types.js';

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

  cacheIdentity(): string {
    const source = this.catalogStore.getSource('xopc-cloud');
    return JSON.stringify([source?.baseUrl, source?.search]);
  }

  isAvailable(): boolean {
    return Boolean(this.catalogStore.getSource('xopc-cloud')?.search);
  }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    return (await this.searchWithMetadata(query, count, signal)).results;
  }

  async searchWithMetadata(query: string, count: number, signal?: AbortSignal): Promise<SearchExecution> {
    const source = this.catalogStore.getSource('xopc-cloud');
    if (!source?.search) throw new Error('XOPC Cloud search is not available');
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud', requestSignal);
    if (!accessToken) throw searchHttpError(new Response(null, { status: 401 }), 'XOPC Cloud is not connected');
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
      upstream?: unknown;
      trace?: unknown;
    } | null;
    if (!response.ok) {
      throw searchHttpError(response,
        typeof body?.error?.message === 'string'
          ? body.error.message
          : `XOPC Cloud search failed (${response.status})`,
      );
    }
    if (!Array.isArray(body?.results)) throw new Error('XOPC Cloud search returned an invalid response');
    const results = body.results.flatMap((result) => {
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
    const upstream = searchProviderId(response.headers.get('x-xopc-search-upstream')) ?? searchProviderId(body.upstream);
    const countHeader = response.headers.get('x-xopc-provider-attempts');
    const attemptCount = countHeader !== null && /^\d{1,4}$/.test(countHeader) && Number(countHeader) > 0 ? Number(countHeader) : undefined;
    const attempts = Array.isArray(body.trace) ? body.trace.slice(0, 24).flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const source = searchProviderId(row.provider);
      if (!source || !['success', 'empty', 'error', 'skipped'].includes(String(row.outcome))) return [];
      const reason = typeof row.reason === 'string' && /^[a-z_]{1,64}$/.test(row.reason) ? row.reason : undefined;
      return [{ provider: this.name, upstream: source, outcome: row.outcome as 'success' | 'empty' | 'error' | 'skipped', ...(reason ? { reason } : {}) }];
    }) : undefined;
    return { results, metadata: { ...(upstream ? { upstream } : {}), ...(attemptCount ? { attemptCount } : {}),
      ...(attempts?.length ? { attempts } : {}) } };
  }
}

function searchProviderId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : undefined;
}
