import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogStore } from '../model-catalog-store.js';
import { ModelCatalogSyncService } from '../model-catalog-sync-service.js';
import type { XopcCloudCatalogCoordinator } from '../xopc-cloud-catalog-coordinator.js';

describe('ModelCatalogSyncService', () => {
  it('coalesces concurrent refreshes and reports success', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn(async () => {
      await wait;
      return { state: 'ready' as const, source: 'network' as const, modelCount: 2 };
    });
    const onUpdated = vi.fn();
    const service = new ModelCatalogSyncService({
      xopcCloud: { refresh } as Pick<XopcCloudCatalogCoordinator, 'refresh'>,
      onUpdated,
    });

    const first = service.refreshNow();
    const second = service.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);

    expect(onUpdated).toHaveBeenCalledWith(2);
    expect(service.getStatus()).toMatchObject({ refreshing: false, lastError: undefined });
  });

  it('discovers enabled OpenAI-compatible providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-model-sync-'));
    try {
      const store = new ModelCatalogStore();
      const refreshModels = vi.fn();
      let providers = {
        custom: {
          baseUrl: 'https://models.example/v1',
          api: 'openai-completions' as const,
          modelDiscovery: { enabled: true },
        },
      };
      const service = new ModelCatalogSyncService({
        xopcCloud: {
          refresh: vi.fn(async () => ({ state: 'not-authorized' as const, source: 'none' as const, modelCount: 0 })),
        },
        catalogStore: store,
        loadProviders: () => providers,
        discoverModels: vi.fn(async () => [{ id: 'model-a', name: 'Model A', source: 'live' as const }]),
        refreshModels,
        getModelCount: () => 1,
      });

      await expect(service.refreshAll()).resolves.toEqual({ updatedSources: ['custom'] });
      expect(store.getSource('provider:custom')?.models[0]).toMatchObject({
        id: 'model-a',
        availability: 'available',
      });
      expect(refreshModels).toHaveBeenCalledOnce();

      providers = {} as typeof providers;
      await service.refreshAll();
      expect(store.getSource('provider:custom')).toBeUndefined();
      expect(refreshModels).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('notifies consumers when permanent auth failure clears the cloud catalog', async () => {
    const onUpdated = vi.fn();
    const service = new ModelCatalogSyncService({
      xopcCloud: {
        refresh: vi.fn(async () => ({
          state: 'not-authorized' as const,
          source: 'none' as const,
          modelCount: 0,
          error: { code: 'invalid_token', message: 'revoked', retryable: false },
        })),
      },
      onUpdated,
    });

    await service.refreshNow();

    expect(onUpdated).toHaveBeenCalledWith(0);
    expect(service.getStatus().lastError).toBe('revoked');
  });
});
