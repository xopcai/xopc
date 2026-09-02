import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';
import {
  resolveEffectiveModelIntents,
  resolveModelIntentRef,
  resolveModelSelector,
} from '../agent-model-intents.js';

const config = ConfigSchema.parse({
  agents: {
    default: 'research',
    defaults: {
      models: {
        chat: { primary: 'openai/gpt-4.1', fallbacks: [] },
        intents: {
          fast: { primary: 'openai/gpt-4.1-mini', fallbacks: [] },
          reasoning: { primary: 'anthropic/claude-sonnet-4', fallbacks: ['openai/gpt-4.1'] },
        },
      },
    },
    list: [{
      id: 'research',
      models: {
        intents: { fast: { primary: 'google/gemini-2.5-flash', fallbacks: [] } },
      },
    }],
  },
});

describe('agent model intents', () => {
  it('resolves global intents with agent overrides', () => {
    const intents = resolveEffectiveModelIntents(config, 'research');
    expect(intents.get('fast')?.model).toBe('google/gemini-2.5-flash');
    expect(intents.get('reasoning')?.model).toBe('anthropic/claude-sonnet-4');
  });

  it('resolves fixed intent selectors and direct model refs', () => {
    expect(resolveModelIntentRef(config, 'research', 'fast')).toBe('google/gemini-2.5-flash');
    expect(resolveModelSelector(config, 'research', '@reasoning')).toBe('anthropic/claude-sonnet-4');
    expect(resolveModelSelector(config, 'research', 'openai/gpt-4.1')).toBe('openai/gpt-4.1');
  });

  it('falls back to the effective chat model when an intent is not configured', () => {
    expect(resolveModelSelector(config, 'research', '@review')).toBe('openai/gpt-4.1');
  });

  it('rejects arbitrary model role names', () => {
    expect(() => resolveModelSelector(config, 'research', 'large')).toThrow("Unknown model intent 'large'");
  });
});
