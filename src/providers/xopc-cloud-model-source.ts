import { getModelCatalogStore, type ModelCatalogStore } from './model-catalog-store.js';
import { getModelRegistry } from './model-registry.js';
import { getProviderAuthService, type ProviderAuthService } from './provider-auth-service.js';
import { resolveXopcModelRouterUrl } from './xopc-cloud-config.js';
import { reloadImageGenerationProviders } from '../agent/image/generation/provider-registry.js';

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
      data?: Array<{
        id?: unknown;
        xopc?: {
          kind?: unknown;
          maxOutputTokens?: unknown;
          operations?: unknown;
          capabilities?: {
            input?: unknown;
            output?: unknown;
            operations?: unknown;
            reasoning?: unknown;
            imageGeneration?: unknown;
          };
        };
      }>;
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
    const models = [...new Map(body.data
      .filter((model): model is typeof model & { id: string } =>
        typeof model.id === 'string' && model.id.length > 0)
      .map((model) => {
        const declaredInput = model.xopc?.capabilities?.input;
        const parsedInput: Array<'text' | 'image'> = Array.isArray(declaredInput)
          ? declaredInput.filter((value): value is 'text' | 'image' =>
              value === 'text' || value === 'image')
          : [];
        const input: Array<'text' | 'image'> = parsedInput.includes('text')
          ? [...new Set(parsedInput)]
          : ['text', ...new Set(parsedInput)];
        const maxOutputTokens = model.xopc?.maxOutputTokens;
        const declaredOutput = model.xopc?.capabilities?.output;
        const output = Array.isArray(declaredOutput)
          ? declaredOutput.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
          : ['text' as const];
        const declaredOperations = model.xopc?.operations ?? model.xopc?.capabilities?.operations;
        const operations = Array.isArray(declaredOperations)
          ? declaredOperations.filter((value): value is 'chat.completions' | 'responses' | 'images.generate' | 'images.edit' =>
              value === 'chat.completions' || value === 'responses'
              || value === 'images.generate' || value === 'images.edit')
          : ['chat.completions' as const, 'responses' as const];
        const generation = parseImageGenerationCapabilities(model.xopc?.capabilities?.imageGeneration);
        return [model.id, {
          id: model.id,
          name: model.id,
          kind: model.xopc?.kind === 'image' ? 'image' as const : 'language' as const,
          input,
          output,
          operations,
          reasoning: model.xopc?.capabilities?.reasoning === true,
          contextWindow: 128_000,
          maxOutputTokens: typeof maxOutputTokens === 'number' && Number.isSafeInteger(maxOutputTokens)
            ? maxOutputTokens
            : null,
          ...(generation ? { imageGeneration: generation } : {}),
        }] as const;
      })).values()];
    this.catalogStore.replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: this.routerUrl,
      api: 'openai-completions',
      etag: response.headers.get('x-xopc-model-catalog-version'),
      recommendedModel: models[0]?.id ?? null,
      lastSuccessAt: Date.now(),
    }, models);
    this.refreshModels();
    reloadImageGenerationProviders();
    return { status: 'updated', modelCount: models.length, models: models.map((model) => model.id) };
  }
}

function parseImageGenerationCapabilities(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const strings = <T extends string>(candidate: unknown, allowed?: readonly T[]): T[] =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is T =>
          typeof item === 'string' && (!allowed || allowed.includes(item as T)))
      : [];
  return {
    maxCount: Number.isSafeInteger(raw.maxCount) && Number(raw.maxCount) > 0 ? Number(raw.maxCount) : 1,
    sizes: strings<string>(raw.sizes),
    qualities: strings(raw.qualities, ['low', 'medium', 'high', 'auto'] as const),
    formats: strings(raw.formats, ['png', 'jpeg', 'webp'] as const),
    backgrounds: strings(raw.backgrounds, ['transparent', 'opaque', 'auto'] as const),
    maxInputImages: Number.isSafeInteger(raw.maxInputImages) && Number(raw.maxInputImages) > 0
      ? Number(raw.maxInputImages)
      : 0,
  };
}
