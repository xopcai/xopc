import { describe, expect, it } from 'vitest';

import type { AgentDefaults, AgentEntry } from '../schema.js';
import { resolveEffectiveAgentConfig } from '../resolver.js';

const defaults: AgentDefaults = {
  models: {
    chat: { primary: 'anthropic/claude-sonnet', fallbacks: ['openai/gpt'] },
    intents: {
      fast: { primary: 'openai/mini', fallbacks: [] },
      coding: { primary: 'openai/codex', fallbacks: [] },
    },
  },
  skills: { mode: 'selected', include: ['general', 'research'] },
  tools: {
    exec_command: { mode: 'deny' },
    web_search: { mode: 'allow' },
  },
  workflows: { default: 'general' },
  runtime: { timeoutMs: 60_000, maxTurns: 20 },
};

function agent(patch: Partial<AgentEntry> = {}): AgentEntry {
  return { id: 'coder', enabled: true, ...patch };
}

describe('resolveEffectiveAgentConfig', () => {
  it('inherits global defaults for a minimal agent', () => {
    const result = resolveEffectiveAgentConfig({ defaults, agent: agent() });

    expect(result.config.models.chat.primary).toBe('anthropic/claude-sonnet');
    expect(result.config.skills).toEqual({ mode: 'selected', include: ['general', 'research'] });
    expect(result.config.workspace).toBe('~/.xopc/workspace/coder');
    expect(result.sources['models.chat.primary']).toBe('global');
  });

  it('replaces a chat route atomically and merges fixed model intents by key', () => {
    const result = resolveEffectiveAgentConfig({
      defaults,
      agent: agent({
        models: {
          chat: { primary: 'google/gemini', fallbacks: [] },
          intents: {
            fast: null,
            review: { primary: 'anthropic/reviewer', fallbacks: [] },
          },
        },
      }),
    });

    expect(result.config.models.chat).toEqual({ primary: 'google/gemini', fallbacks: [] });
    expect(result.config.models.intents.fast).toBeUndefined();
    expect(result.config.models.intents.coding?.primary).toBe('openai/codex');
    expect(result.config.models.intents.review?.primary).toBe('anthropic/reviewer');
    expect(result.sources['models.chat.primary']).toBe('agent');
    expect(result.sources['models.intents.fast.primary']).toBeUndefined();
  });

  it('applies skill additions and removals without freezing inherited values', () => {
    const result = resolveEffectiveAgentConfig({
      defaults,
      agent: agent({ skills: { mode: 'merge', add: ['coding'], remove: ['research'] } }),
    });

    expect(result.config.skills).toEqual({ mode: 'selected', include: ['coding', 'general'] });
    expect(result.sources['skills.include']).toBe('agent');
  });

  it('tracks exclusions when the global default exposes all enabled skills', () => {
    const result = resolveEffectiveAgentConfig({
      defaults: { ...defaults, skills: { mode: 'all-enabled', exclude: ['unsafe'] } },
      agent: agent({ skills: { mode: 'merge', add: ['unsafe'], remove: ['music'] } }),
    });

    expect(result.config.skills).toEqual({ mode: 'all-enabled', exclude: ['music'] });
  });

  it('allows an agent to override a global tool decision', () => {
    const result = resolveEffectiveAgentConfig({
      defaults,
      agent: agent({ tools: { exec_command: { mode: 'allow' } } }),
    });

    expect(result.config.tools.exec_command?.mode).toBe('allow');
    expect(result.config.tools.web_search?.mode).toBe('allow');
    expect(result.sources['tools.exec_command.mode']).toBe('agent');
  });

  it('does not mutate the declared defaults or agent override', () => {
    const localAgent = agent({ skills: { mode: 'replace', include: ['coding'] } });
    const defaultsBefore = structuredClone(defaults);
    const agentBefore = structuredClone(localAgent);

    resolveEffectiveAgentConfig({ defaults, agent: localAgent });

    expect(defaults).toEqual(defaultsBefore);
    expect(localAgent).toEqual(agentBefore);
  });

  it('rejects contradictory skill deltas', () => {
    expect(() => resolveEffectiveAgentConfig({
      defaults,
      agent: agent({ skills: { mode: 'merge', add: ['coding'], remove: ['coding'] } }),
    })).toThrow('cannot be both added and removed');
  });
});
