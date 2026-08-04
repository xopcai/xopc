import { createLogger } from '../utils/logger.js';
import type { Config } from '../config/schema.js';
import { loadModelsJson, type ModelsJsonConfig } from '../config/models-json.js';
import { getModelCatalogStore, type ModelCatalogStore } from './model-catalog-store.js';
import { discoverProviderModels, isProviderApiDiscoverable } from './model-discovery.js';
import { getModelRegistry } from './model-registry.js';
import { XopcCloudModelSource } from './xopc-cloud-model-source.js';

const log = createLogger('ModelCatalogSync');
const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000;

export interface ModelCatalogSyncStatus {
  running: boolean;
  refreshing: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  sourceErrors?: Record<string, string>;
}

export class ModelCatalogSyncService {
  private readonly xopcCloud: XopcCloudModelSource;
  private timer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<Awaited<ReturnType<XopcCloudModelSource['refresh']>>> | null = null;
  private refreshAllPromise: Promise<{ updatedSources: string[] }> | null = null;
  private status: ModelCatalogSyncStatus = { running: false, refreshing: false };

  constructor(
    private readonly options: {
      intervalMs?: number;
      onUpdated?: (modelCount: number) => void;
      xopcCloud?: XopcCloudModelSource;
      getConfig?: () => Config;
      catalogStore?: ModelCatalogStore;
      loadProviders?: () => ModelsJsonConfig['providers'];
      discoverModels?: typeof discoverProviderModels;
      refreshModels?: () => void;
      getModelCount?: () => number;
    } = {},
  ) {
    this.xopcCloud = options.xopcCloud ?? new XopcCloudModelSource();
  }

  start(): void {
    if (this.status.running) return;
    const settings = this.options.getConfig?.().modelCatalog;
    if (settings?.enabled === false) return;
    this.status.running = true;
    if (settings?.refreshOnStartup !== false) {
      queueMicrotask(() => void this.refreshAll().catch(() => {}));
    }
    const intervalMs = this.options.intervalMs ?? (settings?.intervalHours ?? 6) * 60 * 60_000;
    this.timer = setInterval(
      () => void this.refreshAll().catch(() => {}),
      intervalMs || DEFAULT_INTERVAL_MS,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
  }

  getStatus(): ModelCatalogSyncStatus {
    return { ...this.status };
  }

  refreshNow(): Promise<Awaited<ReturnType<XopcCloudModelSource['refresh']>>> {
    if (this.refreshPromise) return this.refreshPromise;
    this.status.refreshing = true;
    this.status.lastAttemptAt = Date.now();
    this.refreshPromise = this.xopcCloud.refresh()
      .then((result) => {
        if (result.status === 'updated') {
          this.status.lastSuccessAt = Date.now();
          this.status.lastError = undefined;
          this.options.onUpdated?.(result.modelCount ?? 0);
        }
        return result;
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.status.lastError = errorMessage;
        log.warn({ err, errorMessage }, `Model catalog refresh failed: ${errorMessage}`);
        throw err;
      })
      .finally(() => {
        this.status.refreshing = false;
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  refreshAll(): Promise<{ updatedSources: string[] }> {
    if (this.refreshAllPromise) return this.refreshAllPromise;
    this.status.refreshing = true;
    this.refreshAllPromise = this.refreshAllSources().finally(() => {
      this.status.refreshing = false;
      this.refreshAllPromise = null;
    });
    return this.refreshAllPromise;
  }

  private async refreshAllSources(): Promise<{ updatedSources: string[] }> {
    const updatedSources: string[] = [];
    const sourceErrors: Record<string, string> = {};
    try {
      const cloud = await this.refreshNow();
      if (cloud.status === 'updated') updatedSources.push('xopc-cloud');
    } catch (err) {
      sourceErrors['xopc-cloud'] = err instanceof Error ? err.message : String(err);
    }
    this.status.refreshing = true;

    const providers = this.options.loadProviders?.() ?? loadModelsJson().config.providers;
    const discoverable = Object.entries(providers).filter(([, provider]) =>
      provider.modelDiscovery?.enabled === true &&
      typeof provider.baseUrl === 'string' &&
      isProviderApiDiscoverable(provider.api),
    );
    const catalogStore = this.options.catalogStore ?? getModelCatalogStore();
    const enabledSourceIds = new Set(discoverable.map(([providerId]) => `provider:${providerId}`));
    const removedSource = Object.keys(catalogStore.load().sources)
      .filter((sourceId) => sourceId.startsWith('provider:') && !enabledSourceIds.has(sourceId))
      .map((sourceId) => catalogStore.removeSource(sourceId))
      .some(Boolean);
    const results = await Promise.all(discoverable.map(async ([providerId, provider]) => {
      try {
        const models = await (this.options.discoverModels ?? discoverProviderModels)({
          providerId,
          baseUrl: provider.baseUrl!,
          apiKey: provider.apiKey,
          api: provider.api,
          headers: provider.headers,
        });
        catalogStore.replaceSourceModels(`provider:${providerId}`, {
          providerId,
          baseUrl: provider.baseUrl!,
          api: provider.api === 'openai-responses' ? 'openai-responses' : 'openai-completions',
          etag: null,
          recommendedModel: null,
          lastSuccessAt: Date.now(),
        }, models.map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          maxOutputTokens: null,
        })));
        return providerId;
      } catch (err) {
        sourceErrors[providerId] = err instanceof Error ? err.message : String(err);
        return null;
      }
    }));
    for (const providerId of results) {
      if (providerId) updatedSources.push(providerId);
    }
    const genericUpdated = results.some(Boolean) || removedSource;
    if (genericUpdated) {
      (this.options.refreshModels ?? (() => getModelRegistry().refresh()))();
      this.status.lastSuccessAt = Date.now();
      this.options.onUpdated?.(
        this.options.getModelCount?.() ?? getModelRegistry().getAll().length,
      );
    }
    this.status.sourceErrors = Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined;
    return { updatedSources };
  }
}
