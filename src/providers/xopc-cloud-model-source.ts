import { getModelCatalogStore, type ModelCatalogStore } from './model-catalog-store.js';
import { getModelRegistry } from './model-registry.js';
import { getProviderAuthService, type ProviderAuthService } from './provider-auth-service.js';
import { resolveXopcModelRouterUrl } from './xopc-cloud-config.js';

export type XopcCloudModelRefreshResult =
  | { status: 'skipped'; reason: 'not_configured' }
  | { status: 'updated'; modelCount: number; models: string[] };

export class XopcCloudModelError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'XopcCloudModelError';
  }
}

export class XopcCloudModelSource {
  private readonly fetchImpl: typeof fetch;
  private readonly routerUrl: string;
  private readonly credentials: Pick<ProviderAuthService, 'resolveApiKey'>;
  private readonly catalogStore: ModelCatalogStore;
  private readonly refreshModels: () => void;

  constructor(options: {
    fetchImpl?: typeof fetch;
    routerUrl?: string;
    credentials?: Pick<ProviderAuthService, 'resolveApiKey'>;
    catalogStore?: ModelCatalogStore;
    refreshModels?: () => void;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.routerUrl = resolveXopcModelRouterUrl(options.routerUrl);
    this.credentials = options.credentials ?? getProviderAuthService();
    this.catalogStore = options.catalogStore ?? getModelCatalogStore();
    this.refreshModels = options.refreshModels ?? (() => getModelRegistry().refresh());
  }

  async refresh(): Promise<XopcCloudModelRefreshResult> {
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud');
    if (!accessToken) return { status: 'skipped', reason: 'not_configured' };
    const response = await this.fetchImpl(`${this.routerUrl}/models`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null) as {
      data?: Array<{ id?: unknown }>;
      error?: { message?: unknown; code?: unknown };
    } | null;
    if (!response.ok) {
      throw new XopcCloudModelError(
        typeof body?.error?.message === 'string' ? body.error.message : `XOPC model discovery failed (${response.status})`,
        response.status,
        typeof body?.error?.code === 'string' ? body.error.code : undefined,
      );
    }
    if (!Array.isArray(body?.data)) {
      throw new XopcCloudModelError(
        'XOPC model discovery returned an invalid response',
        response.status,
        'invalid_response',
      );
    }
    const models = [...new Set(body.data
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0))];
    this.catalogStore.replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: this.routerUrl,
      api: 'openai-completions',
      etag: response.headers.get('x-xopc-model-catalog-version'),
      recommendedModel: models[0] ?? null,
      lastSuccessAt: Date.now(),
    }, models.map((id) => ({ id, name: id, maxOutputTokens: null })));
    this.refreshModels();
    return { status: 'updated', modelCount: models.length, models };
  }
}
