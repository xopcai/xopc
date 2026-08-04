import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogStore } from '../model-catalog-store.js';
import { XopcCloudModelError, XopcCloudModelSource } from '../xopc-cloud-model-source.js';

describe('XopcCloudModelSource', () => {
  it('skips discovery when OAuth is not configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const source = new XopcCloudModelSource({
      fetchImpl,
      credentials: { resolveApiKey: async () => null },
    });

    await expect(source.refresh()).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('atomically replaces the in-memory model snapshot using OAuth bearer auth', async () => {
    const store = new ModelCatalogStore();
    const refreshModels = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access');
      return Response.json({
        object: 'list',
        data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, { id: '' }],
      }, { headers: { 'x-xopc-model-catalog-version': 'catalog-2' } });
    });
    const source = new XopcCloudModelSource({
      fetchImpl,
      routerUrl: 'https://router.test/v1/',
      credentials: { resolveApiKey: async () => 'oauth-access' },
      catalogStore: store,
      refreshModels,
    });

    await expect(source.refresh()).resolves.toEqual({
      status: 'updated',
      modelCount: 2,
      models: ['model-b', 'model-a'],
    });
    expect(store.getSource('xopc-cloud')).toMatchObject({
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.test/v1',
      etag: 'catalog-2',
      models: [
        { id: 'model-b', availability: 'available' },
        { id: 'model-a', availability: 'available' },
      ],
    });
    expect(refreshModels).toHaveBeenCalledOnce();
  });

  it('preserves structured model service failures', async () => {
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({
        error: { message: 'OAuth grant revoked', code: 'invalid_token' },
      }, { status: 401 }),
      credentials: { resolveApiKey: async () => 'expired-token' },
    });

    await expect(source.refresh()).rejects.toMatchObject<XopcCloudModelError>({
      name: 'XopcCloudModelError',
      status: 401,
      code: 'invalid_token',
      message: 'OAuth grant revoked',
    });
  });

  it('preserves the last usable snapshot when a successful response is malformed', async () => {
    const store = new ModelCatalogStore();
    store.replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.test/v1',
      api: 'openai-completions',
      etag: 'catalog-1',
      recommendedModel: 'stable-model',
      lastSuccessAt: 1,
    }, [{ id: 'stable-model', name: 'Stable Model', maxOutputTokens: null }]);
    const refreshModels = vi.fn();
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({ object: 'list' }),
      credentials: { resolveApiKey: async () => 'oauth-access' },
      catalogStore: store,
      refreshModels,
    });

    await expect(source.refresh()).rejects.toMatchObject<XopcCloudModelError>({
      status: 200,
      code: 'invalid_response',
    });
    expect(store.getSource('xopc-cloud')).toMatchObject({
      etag: 'catalog-1',
      models: [{ id: 'stable-model', availability: 'available' }],
    });
    expect(refreshModels).not.toHaveBeenCalled();
  });
});
