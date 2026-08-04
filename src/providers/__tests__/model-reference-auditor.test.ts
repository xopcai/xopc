import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { auditModelReferences } from '../model-reference-auditor.js';
import type { ModelRegistry } from '../model-registry.js';

describe('auditModelReferences', () => {
  it('reports unavailable references with their locations and replacement', () => {
    const config = {
      agents: {
        capabilityPresets: {
          default: {
            models: {
              roles: {
                deep: {
                  model: 'cloud/removed',
                  fallbacks: ['cloud/active'],
                },
              },
            },
          },
        },
        list: [],
      },
    } as unknown as Config;
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

    expect(auditModelReferences(config, new Map(), { registry, catalog })).toEqual([
      {
        ref: 'cloud/active',
        availability: 'available',
        locations: ['agents.capabilityPresets.default.models.roles.deep.fallbacks[0]'],
      },
      {
        ref: 'cloud/removed',
        availability: 'unavailable',
        locations: ['agents.capabilityPresets.default.models.roles.deep.model'],
        suggestedRef: 'cloud/active',
      },
    ]);
  });

  it('checks image-generation references against the image provider registry', () => {
    const config = {
      agents: {
        capabilityPresets: {
          images: {
            models: {
              imageGenerationModel: {
                primary: 'minimax/image-01',
                fallbacks: ['missing/image-model'],
              },
            },
          },
        },
        list: [],
      },
    } as unknown as Config;
    const registry = {
      resolve: () => undefined,
    } as unknown as ModelRegistry;
    const catalog = { sources: {} };

    expect(auditModelReferences(config, new Map(), {
      registry,
      catalog,
      resolveImageGenerationModel: (ref) => ref === 'minimax/image-01',
    })).toEqual([
      {
        ref: 'minimax/image-01',
        availability: 'available',
        locations: ['agents.capabilityPresets.images.models.imageGenerationModel.primary'],
      },
      {
        ref: 'missing/image-model',
        availability: 'unavailable',
        locations: ['agents.capabilityPresets.images.models.imageGenerationModel.fallbacks[0]'],
      },
    ]);
  });
});
