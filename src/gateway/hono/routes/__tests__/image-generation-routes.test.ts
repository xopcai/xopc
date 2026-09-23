import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { registerModelsRoutes } from '../models.js';

describe('image generation routes', () => {
  it('returns the global image-generation default', async () => {
    initializeTestAgentCatalog({ defaults: {
      models: {
        chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {},
        imageGeneration: { primary: 'google/gemini-3.1-flash-image', fallbacks: [], autoProviderFallback: false },
      },
      skills: { mode: 'selected', include: [] }, tools: {}, workflows: {}, runtime: {},
    } });
    const currentConfig = ConfigSchema.parse({});
    const app = new Hono();
    registerModelsRoutes(app, {
      service: {
        currentConfig,
        getModelCatalogSync: () => ({ getStatus: () => ({}) }),
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const response = await app.request('/api/image-generation/default');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      payload: {
        model: { primary: 'google/gemini-3.1-flash-image' },
      },
    });
  });
});
