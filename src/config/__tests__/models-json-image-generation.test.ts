import { describe, expect, it } from 'vitest';

import { validateModelsConfig } from '../models-json.js';

function validConfig() {
  return {
    providers: {
      'local-flux': {
        baseUrl: 'http://127.0.0.1:8080/v1',
        imageGeneration: {
          api: 'openai-images' as const,
          name: 'Local Flux',
          defaultModel: 'flux-1-dev',
          auth: { type: 'none' as const },
          models: [{
            id: 'flux-1-dev',
            capabilities: {
              generate: { maxCount: 1, supportsSize: true },
              edit: { enabled: false },
            },
          }],
        },
      },
    },
  };
}

describe('models.json image generation providers', () => {
  it('accepts an explicit OpenAI Images provider definition', () => {
    expect(validateModelsConfig(validConfig())).toEqual({ valid: true, errors: [] });
  });

  it('requires the default image model to exist', () => {
    const config = validConfig();
    config.providers['local-flux'].imageGeneration.defaultModel = 'missing';
    const result = validateModelsConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'providers.local-flux.imageGeneration.defaultModel',
      severity: 'error',
    }));
  });

  it('rejects attempts to replace built-in image providers', () => {
    const config = validConfig();
    config.providers.openai = config.providers['local-flux'];
    delete (config.providers as Record<string, unknown>)['local-flux'];
    const result = validateModelsConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'providers.openai.imageGeneration',
      severity: 'error',
    }));
  });

  it('does not infer legacy or unknown image protocols', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    const provider = (config.providers as Record<string, Record<string, unknown>>)['local-flux']!;
    (provider.imageGeneration as Record<string, unknown>).api = 'openai-compatible';

    expect(validateModelsConfig(config).valid).toBe(false);
  });
});
