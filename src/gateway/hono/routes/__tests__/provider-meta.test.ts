import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';

import * as providers from '../../../../providers/index.js';
import * as presets from '../../../../providers/domestic-presets.js';
import * as presentation from '../../../../providers/presentation.js';
import { registerModelsRoutes } from '../models.js';

vi.mock('../../../../providers/presentation.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../providers/presentation.js')>(),
  getRecommendedModelsForProvider: () => [],
  getOnboardingFeaturedProviders: vi.fn(() => []),
}));

afterEach(() => vi.restoreAllMocks());

it('counts a single fresh model snapshot per metadata request without changing provider auth state', async () => {
  vi.spyOn(providers, 'getAllProviders').mockReturnValue(['openai', 'anthropic']);
  vi.spyOn(presets, 'getDomesticProviderPresetIds').mockReturnValue([]);
  vi.spyOn(providers, 'getModelRegistry').mockReturnValue({ getAll: () => [] } as never);
  vi.spyOn(providers, 'getProviderAuthState').mockImplementation(async id => id === 'openai'
    ? { authMode: 'env', authStatus: 'connected' } : { authMode: 'none', authStatus: 'not_connected' });
  vi.spyOn(providers, 'isProviderConfigured').mockResolvedValue(false);
  const models = vi.spyOn(providers, 'getAllModels').mockReturnValue([
    { id: 'a', provider: 'openai' }, { id: 'b', provider: 'openai' }, { id: 'c', provider: 'anthropic' },
  ] as never);
  const app = new Hono();
  registerModelsRoutes(app, { service: { getModelCatalogSync: () => ({}), getExtensionLoader: () => undefined, currentConfig: {} },
    strictRateLimitMiddleware: async (_c, next) => next() } as never);
  const response = await app.request('/api/providers/meta');
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.payload.providers.find(p => p.id === 'openai')).toMatchObject({ modelCount: 2, configured: true, authMode: 'env', authStatus: 'connected' });
  expect(body.payload.providers.find(p => p.id === 'anthropic')).toMatchObject({ modelCount: 1, configured: false, authMode: 'none' });
  expect(models).toHaveBeenCalledTimes(1);
  expect(presentation.getOnboardingFeaturedProviders).toHaveBeenCalledTimes(1);
  models.mockReturnValue([{ id: 'new', provider: 'anthropic' }] as never);
  const next = await (await app.request('/api/providers/meta')).json();
  expect(next.payload.providers.find(p => p.id === 'anthropic').modelCount).toBe(1);
  expect(next.payload.providers.find(p => p.id === 'openai').modelCount).toBe(0);
  expect(models).toHaveBeenCalledTimes(2);
  expect(presentation.getOnboardingFeaturedProviders).toHaveBeenCalledTimes(2);
});
