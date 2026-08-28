import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogStore, type CatalogSource } from '../model-catalog-store.js';
import { XopcCloudCatalogCoordinator } from '../xopc-cloud-catalog-coordinator.js';

function source(etag = 'catalog-1'): Omit<CatalogSource, 'models'> {
  return {
    providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions',
    etag, recommendedModel: 'chat-1', lastSuccessAt: Date.now(),
  };
}

const models = [{
  id: 'chat-1', name: 'Chat 1', kind: 'language' as const, input: ['text' as const],
  output: ['text' as const], operations: ['chat.completions' as const], reasoning: false,
  contextWindow: 128_000, maxOutputTokens: 8_192,
}];

function coordinator(options: {
  fetch: () => Promise<any>;
  store?: ModelCatalogStore;
  loadSync?: () => CatalogSource | undefined;
  onPermanentAuthFailure?: () => Promise<void>;
}) {
  const store = options.store ?? new ModelCatalogStore();
  const persistence = {
    loadSync: options.loadSync ?? (() => undefined),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  const instance = new XopcCloudCatalogCoordinator({
    source: { fetch: options.fetch }, store, persistence,
    refreshModels: vi.fn(), reloadImageProviders: vi.fn(),
    withLock: async (operation) => operation(),
    onPermanentAuthFailure: options.onPermanentAuthFailure,
  });
  return { instance, store, persistence };
}

describe('XopcCloudCatalogCoordinator', () => {
  it('hydrates a disk snapshot and reports stale state without deleting it', async () => {
    const cached = { ...source(), lastSuccessAt: 1, models: models.map((model) => ({ ...model, availability: 'available' as const })) };
    const { instance, store } = coordinator({ fetch: vi.fn(), loadSync: () => cached });

    await expect(instance.hydrate()).resolves.toMatchObject({ state: 'stale', source: 'disk', modelCount: 1 });
    expect(store.getSource('xopc-cloud')?.etag).toBe('catalog-1');
  });

  it('coalesces refresh, commits once, and preserves the last good snapshot on failure', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await wait;
      return { status: 'fetched' as const, source: source(), models };
    });
    const { instance, store, persistence } = coordinator({ fetch });
    const first = instance.refresh('manual');
    const second = instance.refresh('oauth');
    expect(fetch).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: 'ready', source: 'network', modelCount: 1 }),
      expect.objectContaining({ state: 'ready', source: 'network', modelCount: 1 }),
    ]);
    expect(persistence.save).toHaveBeenCalledOnce();

    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(instance.refresh('recovery')).resolves.toMatchObject({
      state: 'ready', modelCount: 1, error: { code: 'refresh_failed' },
    });
    expect(store.getSource('xopc-cloud')?.etag).toBe('catalog-1');
  });

  it('lets clear invalidate an in-flight refresh generation', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const { instance, store, persistence } = coordinator({
      fetch: async () => {
        await wait;
        return { status: 'fetched' as const, source: source(), models };
      },
    });
    const refresh = instance.refresh('manual');
    const clear = instance.clear('revoke');
    release();
    await Promise.all([refresh, clear]);

    expect(store.getSource('xopc-cloud')).toBeUndefined();
    expect(persistence.clear).toHaveBeenCalled();
    expect(instance.snapshot().state).toBe('not-authorized');
  });

  it('disconnects the provider after a permanent token failure', async () => {
    const failure = Object.assign(new Error('OAuth grant revoked'), {
      name: 'XopcCloudModelError', status: 401, code: 'invalid_token',
    });
    const onPermanentAuthFailure = vi.fn(async () => {});
    const { instance } = coordinator({
      fetch: async () => { throw failure; },
      onPermanentAuthFailure,
    });

    await expect(instance.refresh('recovery')).resolves.toMatchObject({
      state: 'not-authorized',
      modelCount: 0,
      error: { code: 'invalid_token', retryable: false },
    });
    expect(onPermanentAuthFailure).toHaveBeenCalledOnce();
  });

  it('removes a hydrated snapshot when credentials no longer exist', async () => {
    const cached = {
      ...source(),
      models: models.map((model) => ({ ...model, availability: 'available' as const })),
    };
    const { instance, store, persistence } = coordinator({
      fetch: async () => ({ status: 'skipped' as const, reason: 'not_configured' as const }),
      loadSync: () => cached,
    });
    await instance.hydrate();

    await expect(instance.refresh('recovery')).resolves.toMatchObject({
      state: 'not-authorized', source: 'none', modelCount: 0,
    });
    expect(store.getSource('xopc-cloud')).toBeUndefined();
    expect(persistence.clear).toHaveBeenCalledOnce();
  });
});
