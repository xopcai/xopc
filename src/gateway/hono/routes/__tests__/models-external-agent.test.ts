import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../../../agent-catalog/repository.js';
import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import * as externalRegistry from '../../../../agent/external/registry.js';
import { closeXopcDatabase } from '../../../../storage/sqlite/connection.js';
import type { GatewayService } from '../../../service.js';
import { registerModelsRoutes } from '../models.js';

afterEach(() => {
  closeXopcDatabase();
  vi.restoreAllMocks();
});

describe('GET /api/models external agent routing', () => {
  it('returns external runtime models, thinking levels, and serviceTiers when agentId is an external runtime agent', async () => {
    initializeTestAgentCatalog();
    new AgentCatalogRepository().create({
      id: 'codex-mobile-models',
      profile: { name: 'Codex' },
      execution: { kind: 'codex' },
    }, { ready: true });

    vi.spyOn(externalRegistry, 'resolveExternalRuntimeModelsPayload').mockResolvedValue({
      runtimeKind: 'codex',
      runtimeLabel: 'Codex',
      status: 'ready',
      defaultModel: 'gpt-6.1-sol',
      models: [
        {
          id: 'gpt-6.1-sol',
          name: 'GPT-6.1 Sol',
          provider: 'Codex',
          contextWindow: 272_000,
          reasoning: true,
          isDefault: true,
          thinking: { mode: 'levels', options: ['low', 'medium', 'high'], initialValue: 'high', supportsAdaptive: false },
          serviceTiers: [{ id: 'priority', label: 'Fast', description: '1.5x speed, increased usage' }],
        },
      ],
    });

    const app = new Hono();
    registerModelsRoutes(app, {
      service: {
        isGatewayReady: () => true,
        getModelCatalogSync: () => ({}),
      } as unknown as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const res = await app.request('/api/models?agentId=codex-mobile-models');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      payload: {
        defaultId: string;
        models: Array<{ id: string; provider: string; serviceTiers?: Array<{ id: string; label: string }> }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.defaultId).toBe('gpt-6.1-sol');
    expect(body.payload.models).toEqual([
      expect.objectContaining({
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        provider: 'Codex',
        reasoning: true,
        recommended: true,
        serviceTiers: [{ id: 'priority', label: 'Fast', description: '1.5x speed, increased usage' }],
      }),
    ]);
  });
});
