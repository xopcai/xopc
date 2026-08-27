import { withOAuthProviderLock } from '../auth/oauth-provider-lock.js';
import { reloadImageGenerationProviders } from '../agent/image/generation/provider-registry.js';
import { createLogger } from '../utils/logger.js';
import { ModelCatalogPersistence } from './model-catalog-persistence.js';
import {
  getModelCatalogStore,
  type CatalogSourceOrigin,
  type ModelCatalogStore,
} from './model-catalog-store.js';
import { getModelRegistry } from './model-registry.js';
import { XopcCloudModelSource } from './xopc-cloud-model-source.js';

const log = createLogger('XopcCloudCatalog');
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60_000;

export type CatalogEnsureReason = 'startup' | 'oauth' | 'agent-run' | 'manual' | 'recovery';

export interface EnsureCatalogOptions {
  reason: CatalogEnsureReason;
  network: 'never' | 'if-empty' | 'always';
  timeoutMs?: number;
}

export interface CatalogReadiness {
  state: 'not-authorized' | 'ready' | 'stale' | 'refreshing' | 'unavailable';
  source: CatalogSourceOrigin | 'none';
  fetchedAt?: number;
  catalogVersion?: string | null;
  modelCount: number;
  error?: { code: string; message: string; retryable: boolean };
}

interface CatalogCoordinatorOptions {
  source?: Pick<XopcCloudModelSource, 'fetch'>;
  store?: ModelCatalogStore;
  persistence?: Pick<ModelCatalogPersistence, 'loadSync' | 'save' | 'clear'>;
  staleAfterMs?: number;
  refreshModels?: () => void;
  reloadImageProviders?: () => void;
  withLock?: <T>(operation: () => Promise<T>) => Promise<T>;
  onPermanentAuthFailure?: () => Promise<void>;
}

export class XopcCloudCatalogCoordinator {
  private readonly source: Pick<XopcCloudModelSource, 'fetch'>;
  private readonly store: ModelCatalogStore;
  private readonly persistence: Pick<ModelCatalogPersistence, 'loadSync' | 'save' | 'clear'>;
  private readonly staleAfterMs: number;
  private readonly refreshModels: () => void;
  private readonly reloadImageProviders: () => void;
  private readonly withLock: <T>(operation: () => Promise<T>) => Promise<T>;
  private readonly onPermanentAuthFailure: () => Promise<void>;
  private refreshPromise: Promise<CatalogReadiness> | null = null;
  private generation = 0;
  private lastError: CatalogReadiness['error'];
  private notAuthorized = false;

  constructor(options: CatalogCoordinatorOptions = {}) {
    this.source = options.source ?? new XopcCloudModelSource();
    this.store = options.store ?? getModelCatalogStore();
    this.persistence = options.persistence ?? new ModelCatalogPersistence();
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.refreshModels = options.refreshModels ?? (() => getModelRegistry().refresh());
    this.reloadImageProviders = options.reloadImageProviders ?? reloadImageGenerationProviders;
    this.withLock = options.withLock ?? ((operation) => withOAuthProviderLock('xopc-cloud', operation));
    this.onPermanentAuthFailure = options.onPermanentAuthFailure ?? (async () => {
      const { disconnectProvider } = await import('./provider-disconnect.js');
      await disconnectProvider('xopc-cloud');
    });
  }

  async hydrate(): Promise<CatalogReadiness> {
    if (!this.store.getSource('xopc-cloud')) {
      const source = this.persistence.loadSync();
      if (source) this.store.saveSource('xopc-cloud', source, 'disk');
    }
    return this.snapshot();
  }

  async ensure(options: EnsureCatalogOptions): Promise<CatalogReadiness> {
    await this.hydrate();
    if (options.network === 'never') return this.snapshot();
    if (options.network === 'if-empty' && this.store.getSource('xopc-cloud')) {
      return this.snapshot();
    }
    return this.refresh(options.reason, options.timeoutMs);
  }

  refresh(reason: CatalogEnsureReason, timeoutMs = 30_000): Promise<CatalogReadiness> {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    this.refreshPromise = this.runRefresh(reason, generation, timeoutMs).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async clear(reason: 'revoke' | 'invalid-grant'): Promise<void> {
    this.generation += 1;
    await this.withLock(async () => {
      this.store.removeSource('xopc-cloud');
      await this.persistence.clear();
      this.lastError = undefined;
      this.notAuthorized = reason === 'revoke' || reason === 'invalid-grant';
      this.refreshModels();
      this.reloadImageProviders();
      log.info({ provider: 'xopc-cloud', reason, phase: 'catalog_commit' }, 'Cleared XOPC Cloud model catalog');
    });
  }

  snapshot(): CatalogReadiness {
    return this.buildSnapshot(this.refreshPromise !== null);
  }

  private buildSnapshot(refreshing: boolean): CatalogReadiness {
    const source = this.store.getSource('xopc-cloud');
    if (!source) {
      return {
        state: this.notAuthorized ? 'not-authorized' : 'unavailable',
        source: 'none',
        modelCount: 0,
        ...(this.lastError ? { error: this.lastError } : {}),
      };
    }
    const stale = Date.now() - source.lastSuccessAt > this.staleAfterMs;
    return {
      state: refreshing ? 'refreshing' : stale ? 'stale' : 'ready',
      source: this.store.getSourceOrigin('xopc-cloud') ?? 'memory',
      fetchedAt: source.lastSuccessAt,
      catalogVersion: source.etag,
      modelCount: source.models.filter((model) => model.availability === 'available').length,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  private async runRefresh(
    reason: CatalogEnsureReason,
    generation: number,
    timeoutMs: number,
  ): Promise<CatalogReadiness> {
    const startedAt = Date.now();
    try {
      const readiness = await this.withLock(async () => {
        const result = await this.source.fetch(AbortSignal.timeout(timeoutMs));
        if (result.status === 'skipped') {
          await this.clear('revoke');
          return this.buildSnapshot(false);
        }
        if (generation !== this.generation) return this.buildSnapshot(false);

        const previous = this.store.getSource('xopc-cloud');
        const previousOrigin = this.store.getSourceOrigin('xopc-cloud');
        this.store.replaceSourceModels('xopc-cloud', result.source, result.models, 'network');
        const committed = this.store.getSource('xopc-cloud');
        if (!committed) throw new Error('XOPC Cloud catalog commit failed');
        try {
          await this.persistence.save(committed);
        } catch (error) {
          if (previous) {
            this.store.saveSource('xopc-cloud', previous, previousOrigin ?? 'memory');
          } else {
            this.store.removeSource('xopc-cloud');
          }
          throw error;
        }
        if (generation !== this.generation) {
          this.store.removeSource('xopc-cloud');
          await this.persistence.clear();
          return this.buildSnapshot(false);
        }
        this.notAuthorized = false;
        this.lastError = undefined;
        this.refreshModels();
        this.reloadImageProviders();
        return this.buildSnapshot(false);
      });
      log.info(
        { provider: 'xopc-cloud', reason, phase: 'catalog_refresh', durationMs: Date.now() - startedAt },
        `XOPC Cloud model catalog refresh completed with ${readiness.modelCount} models`,
      );
      return readiness;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const modelError = asXopcCloudModelError(err);
      if (modelError?.status === 401 && (modelError.code === 'invalid_grant' || modelError.code === 'invalid_token')) {
        await this.onPermanentAuthFailure();
        this.notAuthorized = true;
      }
      this.lastError = {
        code: modelError ? modelError.code ?? `http_${modelError.status}` : 'refresh_failed',
        message,
        retryable: !modelError || modelError.status === 429 || modelError.status >= 500,
      };
      log.warn(
        { err, provider: 'xopc-cloud', reason, phase: 'catalog_refresh', durationMs: Date.now() - startedAt },
        `XOPC Cloud model catalog refresh failed: ${message}`,
      );
      return this.buildSnapshot(false);
    }
  }
}

function asXopcCloudModelError(error: unknown): { status: number; code?: string } | undefined {
  if (!(error instanceof Error) || error.name !== 'XopcCloudModelError') return undefined;
  const candidate = error as Error & { status?: unknown; code?: unknown };
  if (typeof candidate.status !== 'number') return undefined;
  return {
    status: candidate.status,
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
  };
}

let globalCoordinator: XopcCloudCatalogCoordinator | undefined;

export function getXopcCloudCatalogCoordinator(): XopcCloudCatalogCoordinator {
  globalCoordinator ??= new XopcCloudCatalogCoordinator();
  return globalCoordinator;
}

export function resetXopcCloudCatalogCoordinator(): void {
  globalCoordinator = undefined;
}
