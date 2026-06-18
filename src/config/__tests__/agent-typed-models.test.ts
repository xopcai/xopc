import { describe, expect, it } from 'vitest';

import type { Config } from '../schema.js';
import { ConfigSchema } from '../schema.js';
import {
  resolveEffectiveTypedModels,
  resolveModelRef,
  resolveTypedModelRef,
} from '../agent-typed-models.js';

const baseConfig = {
  agents: {
    defaults: {
      models: {
        roles: {
          small: { description: 'Fast', model: 'deepseek/deepseek-v4-flash' },
          large: { model: 'anthropic/claude-sonnet-4' },
        },
      },
    },
    list: [
      {
        id: 'research',
        enabled: true,
        models: {
          roles: {
            small: { model: 'openai/gpt-4o-mini' },
          },
        },
      },
    ],
  },
} as Config;
describe('resolveEffectiveTypedModels', () => {
  it('returns global defaults for any agent', () => {
    const mainMap = resolveEffectiveTypedModels(baseConfig, 'main');
    const researchMap = resolveEffectiveTypedModels(baseConfig, 'research');
    expect(mainMap.get('small')?.model).toBe('deepseek/deepseek-v4-flash');
    expect(researchMap.get('small')?.model).toBe('openai/gpt-4o-mini');
    expect(researchMap.get('large')?.model).toBe('anthropic/claude-sonnet-4');
  });
});

describe('resolveModelRef', () => {
  it('passes through provider/model refs', () => {
    expect(resolveModelRef(baseConfig, 'main', 'openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('resolves typed id from defaults', () => {
    expect(resolveModelRef(baseConfig, 'main', 'small')).toBe('deepseek/deepseek-v4-flash');
  });

  it('supports @ prefix for typed ids', () => {
    expect(resolveModelRef(baseConfig, 'main', '@large')).toBe('anthropic/claude-sonnet-4');
  });

  it('resolves typed ids from per-agent overrides', () => {
    expect(resolveModelRef(baseConfig, 'research', 'small')).toBe('openai/gpt-4o-mini');
  });

  it('throws for unknown typed id with available hint', () => {
    expect(() => resolveModelRef(baseConfig, 'main', 'missing')).toThrow(
      /Unknown typed model id 'missing'.*available: small, large/,
    );
  });

  it('throws for invalid provider/model', () => {
    expect(() => resolveModelRef(baseConfig, 'main', 'not-a-ref')).toThrow(/Unknown typed model/);
    expect(() => resolveModelRef(baseConfig, 'main', 'bad')).toThrow(/Unknown typed model/);
  });
});

describe('resolveTypedModelRef', () => {
  it('returns undefined when id is not configured', () => {
    expect(resolveTypedModelRef(baseConfig, 'main', 'missing')).toBeUndefined();
  });
});

describe('AgentTypedModelSchema', () => {
  it('accepts per-agent role overrides in the same scope', () => {
    const parsed = ConfigSchema.parse(baseConfig);
    expect(resolveModelRef(parsed, 'research', 'small')).toBe('openai/gpt-4o-mini');
  });

  it('rejects invalid role ids', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          defaults: {
            models: {
              roles: {
                Bad: { model: 'openai/gpt-4o-mini' },
              },
            },
          },
        },
      }),
    ).toThrow(/Invalid key in record/);
  });

  it('rejects invalid model ref format', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          defaults: {
            models: { roles: { small: { model: 'not-valid' } } },
          },
        },
      }),
    ).toThrow(/provider\/model/);
  });
});
