import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { registerModelsRoutes } from '../models.js';
import { getImageGenerationProvider } from '../../../../agent/image/generation/provider-registry.js';
import { assertProviderUsage, getModelUsageOrigin } from '../../../../providers/model-usage.js';

describe('image generation routes', () => {
  afterEach(() => vi.restoreAllMocks());
  it('binds authenticated image diagnostics to an interactive turn without leaking the scope', async () => {
    initializeTestAgentCatalog();
    const provider = getImageGenerationProvider('qwen-token-plan-cn')!;
    vi.spyOn(provider, 'isConfigured').mockReturnValue(true);
    const generate = vi.spyOn(provider, 'generateImage').mockImplementation(async () => {
      assertProviderUsage(provider.id);
      expect(getModelUsageOrigin()).toBe('interactive');
      return { images: [{ buffer: Buffer.from('test-image'), mimeType: 'image/png' }], model:'qwen-image-3.0-pro' };
    });
    const app = new Hono();
    registerModelsRoutes(app, { service: {currentConfig:ConfigSchema.parse({}),getModelCatalogSync:()=>({})}, strictRateLimitMiddleware:async(_c,next)=>next() } as never);
    const response = await app.request('/api/image-generation/providers/qwen-token-plan-cn/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'qwen-image-3.0-pro',prompt:'test'})});
    expect(response.status).toBe(200); expect(generate).toHaveBeenCalledOnce();
    expect(getModelUsageOrigin()).toBe('unknown');
  });
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
