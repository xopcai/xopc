import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { registerModelsRoutes } from '../models.js';

describe('image generation routes', () => {
  it('returns the global image-generation default', async () => {
    const currentConfig = ConfigSchema.parse({
      agents: {
        defaults: {
          models: {
            chat: { primary: 'openai/gpt-5', fallbacks: [] },
            intents: {},
            imageGeneration: {
              primary: 'google/gemini-3.1-flash-image',
              fallbacks: [],
              autoProviderFallback: false,
            },
          },
        },
      },
    });
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
