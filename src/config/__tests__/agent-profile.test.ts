import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';
import {
  resolveEffectiveAgentConfigForAgent,
  resolveEffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../agent-profile.js';

function config() {
  return ConfigSchema.parse({
    agents: {
      default: 'main',
      defaults: {
        models: {
          chat: { primary: 'openai/gpt-5', fallbacks: ['anthropic/claude-sonnet-4-5'] },
          intents: { review: { primary: 'openai/gpt-5.1', fallbacks: [] } },
        },
        skills: { mode: 'selected', include: ['research', 'writing'] },
        tools: { exec_command: { mode: 'ask', timeoutMs: 10_000 } },
        workflows: {},
        runtime: { maxTurns: 8 },
      },
      list: [
        { id: 'main', enabled: true },
        {
          id: 'coder',
          enabled: true,
          workspace: '/tmp/coder',
          models: { chat: { primary: 'anthropic/claude-opus-4-1', fallbacks: [] } },
          skills: { mode: 'merge', add: ['coding'], remove: ['writing'] },
          tools: { exec_command: { mode: 'allow' } },
        },
      ],
    },
  });
}

describe('agent profile', () => {
  it('resolves global defaults and atomic agent overrides', () => {
    const profile = resolveEffectiveAgentProfile(config(), 'coder');
    expect(profile.primaryModelRef).toBe('anthropic/claude-opus-4-1');
    expect(profile.fallbacks).toEqual([]);
    expect(profile.config.models.intents.review?.primary).toBe('openai/gpt-5.1');
    expect(profile.skillsAllowlist).toEqual(['coding', 'research']);
    expect(profile.config.tools.exec_command).toEqual({ mode: 'allow' });
    expect(profile.config.runtime.maxTurns).toBe(8);
  });

  it('returns provenance for the effective view', () => {
    const resolved = resolveEffectiveAgentConfigForAgent(config(), 'coder');
    expect(resolved.sources['models.chat.primary']).toBe('agent');
    expect(resolved.sources['models.intents.review.primary']).toBe('global');
    expect(resolved.sources['tools.exec_command.mode']).toBe('agent');
  });

  it('selects the session agent and falls back to the configured default', () => {
    expect(
      resolveEffectiveAgentProfileForSession(config(), 'agent:coder:telegram:acc_default:direct:123').agentId,
    ).toBe('coder');
    expect(resolveEffectiveAgentProfileForSession(config(), 'invalid').agentId).toBe('main');
  });
});
