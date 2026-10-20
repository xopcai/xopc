import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ store: vi.fn(), builtins: vi.fn(), plugins: vi.fn() }));
vi.mock('@/features/connectors/connectors-api', () => ({ fetchConnectorCatalog: mocks.builtins, fetchStoreConnectorCatalog: mocks.store }));
vi.mock('@/features/extensions/extension-marketplace-api', () => ({ getExtensionMarketplaceItems: mocks.plugins }));
import { fetchRecommendationStoreConnectors, fetchServiceRecommendations } from '../service-recommendation-api';

describe('recommendation catalog loading', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.builtins.mockResolvedValue([]);
    mocks.plugins.mockResolvedValue([]);
  });

  it('loads all pages before ranking, including domestic connectors on later pages', async () => {
    mocks.store.mockImplementation(async ({ page }) => ({ items: page === 3 ? [{ id: 'random-id', name: 'tencent-docs', author: { username: 'team' }, description: '', regions: ['china'] }] : [], meta: { totalPages: 3 } }));
    expect((await fetchServiceRecommendations('zh')).items[0].id).toBe('tencent-docs');
    expect(mocks.store.mock.calls.map(([params]) => params.page)).toEqual([1, 2, 3]);
  });

  it('keeps available sources when one catalog fails and never invents domestic services', async () => {
    mocks.store.mockRejectedValue(new Error('offline'));
    mocks.plugins.mockResolvedValue([{ id: 'feishu', name: 'Feishu', npmPackage: 'feishu', packageType: 'plugin' }]);
    const result = await fetchServiceRecommendations('zh');
    expect(result.failedSources).toBe(1);
    expect(result.items.map(item => item.id)).toEqual(['feishu']);
  });

  it('reports total failure and incomplete pagination for retry', async () => {
    mocks.store.mockRejectedValue(new Error('offline'));
    mocks.plugins.mockRejectedValue(new Error('offline'));
    mocks.builtins.mockRejectedValue(new Error('offline'));
    await expect(fetchServiceRecommendations('zh')).rejects.toThrow('unavailable');
    mocks.store.mockImplementation(async ({ page }) => { if (page === 2) throw new Error('page failed'); return { items: [], meta: { totalPages: 2 } }; });
    await expect(fetchRecommendationStoreConnectors()).rejects.toThrow('page failed');
  });
});
