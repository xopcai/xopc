import { describe, expect, it } from 'vitest';

import type { Config } from '../schema.js';
import { ConfigSchema } from '../schema.js';
import { resolveEffectiveTypedModels, resolveModelRef, resolveTypedModelRef } from '../agent-typed-models.js';

const baseConfig = {
  agents: {
    default: 'main',
    capabilityPresets: {},
    list: [
      {
        id: 'main',
        enabled: true,
        identity: { name: 'Main', role: 'Agent', language: 'en', tone: 'direct' },
        responsibilities: { primary: ['Help'] },
        workspace: { root: '/tmp/main' },
        models: {
          defaultRole: 'small',
          roles: {
            small: { description: 'Fast', model: 'deepseek/deepseek-v4-flash' },
            large: { model: 'anthropic/claude-sonnet-4' },
          },
        },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      },
      {
        id: 'research',
        enabled: true,
        identity: { name: 'Research', role: 'Agent', language: 'en', tone: 'direct' },
        responsibilities: { primary: ['Research'] },
        workspace: { root: '/tmp/research' },
        models: {
          defaultRole: 'small',
          roles: {
            small: { model: 'openai/gpt-4o-mini' },
          },
        },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      },
    ],
  },
} as Config;

describe('resolveEffectiveTypedModels', () => {
  it('returns roles from the selected manifest', () => {
    const mainMap = resolveEffectiveTypedModels(baseConfig, 'main');
    const researchMap = resolveEffectiveTypedModels(baseConfig, 'research');
    expect(mainMap.get('small')?.model).toBe('deepseek/deepseek-v4-flash');
    expect(researchMap.get('small')?.model).toBe('openai/gpt-4o-mini');
    expect(mainMap.get('large')?.model).toBe('anthropic/claude-sonnet-4');
  });
});

describe('resolveModelRef', () => {
  it('passes through provider/model refs', () => {
    expect(resolveModelRef(baseConfig, 'main', 'openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('resolves typed ids from the manifest', () => {
    expect(resolveModelRef(baseConfig, 'main', 'small')).toBe('deepseek/deepseek-v4-flash');
    expect(resolveModelRef(baseConfig, 'main', '@large')).toBe('anthropic/claude-sonnet-4');
    expect(resolveModelRef(baseConfig, 'research', 'small')).toBe('openai/gpt-4o-mini');
  });

  it('throws for unknown typed id with available hint', () => {
    expect(() => resolveModelRef(baseConfig, 'main', 'missing')).toThrow(
      /Unknown typed model id 'missing'.*available: small, large/,
    );
  });
});

describe('resolveTypedModelRef', () => {
  it('returns undefined when id is not configured', () => {
    expect(resolveTypedModelRef(baseConfig, 'main', 'missing')).toBeUndefined();
  });
});

describe('AgentTypedModelSchema', () => {
  it('accepts manifest role configuration', () => {
    const parsed = ConfigSchema.parse(baseConfig);
    expect(resolveModelRef(parsed, 'research', 'small')).toBe('openai/gpt-4o-mini');
  });

  it('rejects invalid role ids', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          list: [
            {
              ...baseConfig.agents!.list[0],
              models: { defaultRole: 'Bad', roles: { Bad: { model: 'openai/gpt-4o-mini' } } },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it('rejects invalid model ref format', () => {
    expect(() =>
      ConfigSchema.parse({
        agents: {
          list: [
            {
              ...baseConfig.agents!.list[0],
              models: { defaultRole: 'small', roles: { small: { model: 'not-valid' } } },
            },
          ],
        },
      }),
    ).toThrow(/provider\/model/);
  });
});
