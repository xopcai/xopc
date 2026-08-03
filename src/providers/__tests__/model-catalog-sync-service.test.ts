import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogStore } from '../model-catalog-store.js';
import { ModelCatalogSyncService } from '../model-catalog-sync-service.js';
import type { XopcCloudConnectionService } from '../xopc-cloud-connection.js';

describe('ModelCatalogSyncService', () => {
  it('coalesces concurrent refreshes and reports success', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const refreshCatalog = vi.fn(async () => {
      await wait;
      return { status: 'updated' as const, modelCount: 2 };
    });
    const onUpdated = vi.fn();
    const service = new ModelCatalogSyncService({
      xopcCloud: { refreshCatalog } as XopcCloudConnectionService,
      onUpdated,
    });

    const first = service.refreshNow();
    const second = service.refreshNow();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);

    expect(onUpdated).toHaveBeenCalledWith(2);
    expect(service.getStatus()).toMatchObject({ refreshing: false, lastError: undefined });
  });

  it('discovers enabled OpenAI-compatible providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-model-sync-'));
    try {
      const store = new ModelCatalogStore(join(dir, 'catalog.json'));
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
          refreshCatalog: vi.fn(async () => ({ status: 'disconnected' as const })),
        } as XopcCloudConnectionService,
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
});
