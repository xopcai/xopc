import { afterEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { auditModelReferences } from '../model-reference-auditor.js';
import type { ModelRegistry } from '../model-registry.js';

describe('auditModelReferences', () => {
  afterEach(() => closeXopcDatabase());

  it('audits GUI bindings without suggesting ordinary chat models', () => {
    const repository = initializeTestAgentCatalog();
    const settings = repository.getSettings();
    repository.updateDefaults({
      ...settings.defaults,
      models: { ...settings.defaults.models, computerUse: { primary: 'cloud/gui', fallbacks: [] } },
    }, settings.revision);
    const registry = { resolve: () => ({ api: 'openai-completions', input: ['text', 'image'] }) } as unknown as ModelRegistry;
    const report = auditModelReferences(new Map(), { registry, catalog: { sources: {} } });
    expect(report).toEqual(expect.arrayContaining([
      { ref: 'cloud/gui', availability: 'unavailable', locations: ['agentCatalog.defaults.models.computerUse.primary'] },
    ]));
    expect(report.find((entry) => entry.ref === 'cloud/gui')).not.toHaveProperty('suggestedRef');
  });
  it('reports unavailable references with their locations and replacement', () => {
    const repository = initializeTestAgentCatalog();
    const settings = repository.getSettings();
    repository.updateDefaults({
      ...settings.defaults,
      models: {
        ...settings.defaults.models,
        chat: { primary: 'cloud/removed', fallbacks: ['cloud/active'] },
      },
    }, settings.revision);
    const registry = {
      resolve: (ref: string) => ref === 'cloud/active' ? { id: 'active' } : undefined,
    } as ModelRegistry;
    const catalog = {
      sources: {
        cloud: {
          providerId: 'cloud',
          baseUrl: 'https://models.example/v1',
          api: 'openai-completions' as const,
          etag: null,
          recommendedModel: 'active',
          lastSuccessAt: 1,
          models: [
            { id: 'active', name: 'Active', availability: 'available' as const, maxOutputTokens: 8192 },
            { id: 'removed', name: 'Removed', availability: 'unavailable' as const, maxOutputTokens: 8192 },
          ],
        },
      },
    };

    expect(auditModelReferences(new Map(), { registry, catalog })).toEqual([
      {
        ref: 'cloud/active',
        availability: 'available',
        locations: ['agentCatalog.defaults.models.chat.fallbacks[0]'],
      },
      {
        ref: 'cloud/removed',
        availability: 'unavailable',
        locations: ['agentCatalog.defaults.models.chat.primary'],
        suggestedRef: 'cloud/active',
      },
    ]);
  });

  it('checks image-generation references against the image provider registry', () => {
    const repository = initializeTestAgentCatalog();
    const settings = repository.getSettings();
    repository.updateDefaults({
      ...settings.defaults,
      models: {
        ...settings.defaults.models,
        imageGeneration: {
          primary: 'minimax/image-01',
          fallbacks: ['missing/image-model'],
        },
      },
    }, settings.revision);
    const registry = {
      resolve: () => undefined,
    } as unknown as ModelRegistry;
    const catalog = { sources: {} };

    expect(auditModelReferences(new Map(), {
      registry,
      catalog,
      resolveImageGenerationModel: (ref) => ref === 'minimax/image-01',
    })).toEqual(expect.arrayContaining([
      {
        ref: 'minimax/image-01',
        availability: 'available',
        locations: ['agentCatalog.defaults.models.imageGeneration.primary'],
      },
      {
        ref: 'missing/image-model',
        availability: 'unavailable',
        locations: ['agentCatalog.defaults.models.imageGeneration.fallbacks[0]'],
      },
    ]));
  });
});
