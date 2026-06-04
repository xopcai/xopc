import { describe, expect, it } from 'vitest';

import type { Config } from '../schema.js';
import { ConfigSchema } from '../schema.js';
import {
  mergeTypedModels,
  resolveEffectiveTypedModels,
  resolveModelRef,
  resolveTypedModelRef,
} from '../agent-typed-models.js';

const baseConfig = {
  agents: {
    defaults: {
      models: [
        { id: 'small', description: 'Fast', model: 'deepseek/deepseek-v4-flash' },
        { id: 'large', model: 'anthropic/claude-sonnet-4' },
      ],
    },
    list: [
      {
        id: 'research',
        enabled: true,
        models: [{ id: 'small', model: 'openai/gpt-4o-mini' }],
      },
    ],
  },
} as Config;

describe('mergeTypedModels', () => {
  it('overlays entry ids onto defaults', () => {
    const merged = mergeTypedModels(baseConfig.agents?.defaults?.models, [
      { id: 'small', model: 'openai/gpt-4o-mini' },
    ]);
    expect(merged.get('small')?.model).toBe('openai/gpt-4o-mini');
    expect(merged.get('large')?.model).toBe('anthropic/claude-sonnet-4');
  });
});

describe('resolveEffectiveTypedModels', () => {
  it('returns defaults for unknown agent', () => {
    const map = resolveEffectiveTypedModels(baseConfig, 'main');
    expect(map.get('small')?.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('applies per-agent override by id', () => {
    const map = resolveEffectiveTypedModels(baseConfig, 'research');
    expect(map.get('small')?.model).toBe('openai/gpt-4o-mini');
    expect(map.get('large')?.model).toBe('anthropic/claude-sonnet-4');
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

  it('uses per-agent typed override', () => {
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
  it('rejects duplicate ids in the same scope', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          defaults: {
            models: [
              { id: 'small', model: 'openai/gpt-4o-mini' },
              { id: 'small', model: 'deepseek/deepseek-v4-flash' },
            ],
          },
        },
      }),
    ).toThrow(/duplicate typed model id 'small'/);
  });

  it('rejects invalid model ref format', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          defaults: {
            models: [{ id: 'small', model: 'not-valid' }],
          },
        },
      }),
    ).toThrow(/provider\/model/);
  });
});
