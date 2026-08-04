import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ModelCatalogStore } from '../model-catalog-store.js';
import { ModelRegistry } from '../model-registry.js';

const tempDirs: string[] = [];

function createStore(): { store: ModelCatalogStore; modelsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-model-catalog-'));
  tempDirs.push(dir);
  return {
    store: new ModelCatalogStore(),
    modelsPath: join(dir, 'models.json'),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ModelCatalogStore', () => {
  it('keeps an isolated in-memory source snapshot', () => {
    const { store } = createStore();
    store.saveSource('cloud', {
      providerId: 'cloud',
      baseUrl: 'https://models.example/v1',
      api: 'openai-completions',
      etag: 'v1',
      recommendedModel: 'model-a',
      lastSuccessAt: 123,
      models: [{
        id: 'model-a',
        name: 'Model A',
        availability: 'available',
        maxOutputTokens: 8192,
      }],
    });

    const snapshot = store.getSource('cloud')!;
    snapshot.models[0].name = 'Mutated';
    expect(store.getSource('cloud')).toMatchObject({
      etag: 'v1',
      recommendedModel: 'model-a',
      models: [{ name: 'Model A' }],
    });
  });

  it('only exposes available remote models through the registry', () => {
    const { store, modelsPath } = createStore();
    store.saveSource('cloud', {
      providerId: 'cloud',
      baseUrl: 'https://models.example/v1',
      api: 'openai-completions',
      etag: null,
      recommendedModel: null,
      lastSuccessAt: 123,
      models: [
        { id: 'active', name: 'Active', availability: 'available', maxOutputTokens: 8192 },
        { id: 'removed', name: 'Removed', availability: 'unavailable', maxOutputTokens: 8192 },
      ],
    });

    const registry = new ModelRegistry(modelsPath, store);
    expect(registry.resolve('cloud/active')?.id).toBe('active');
    expect(registry.resolve('cloud/removed')).toBeUndefined();
  });

  it('retains removed models as unavailable entries', () => {
    const { store } = createStore();
    const source = {
      providerId: 'cloud',
      baseUrl: 'https://models.example/v1',
      api: 'openai-completions' as const,
      etag: null,
      recommendedModel: null,
      lastSuccessAt: 123,
    };
    store.replaceSourceModels('cloud', source, [
      { id: 'old', name: 'Old', maxOutputTokens: 8192 },
    ]);
    const diff = store.replaceSourceModels('cloud', source, [
      { id: 'new', name: 'New', maxOutputTokens: 8192 },
    ]);

    expect(diff).toEqual({ addedCount: 1, unavailableCount: 1 });
    expect(store.getSource('cloud')?.models).toEqual([
      { id: 'new', name: 'New', availability: 'available', maxOutputTokens: 8192 },
      { id: 'old', name: 'Old', availability: 'unavailable', maxOutputTokens: 8192 },
    ]);
  });
});
