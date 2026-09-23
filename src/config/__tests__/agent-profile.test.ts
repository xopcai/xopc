import { ensureSessionRecord as ensureFixtureConversation } from '../../storage/sqlite/session-repository.js';
import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveEffectiveAgentConfigForAgent,
  resolveEffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../agent-profile.js';

function seedConversationFixture(): void {
  ensureFixtureConversation("06457abd-5401-40e9-8812-7511ee1ffd70", '', {"agentId":"coder","sourceChannel":"telegram","sourceChatId":"123","sessionType":"chat","routing":{"agentId":"coder","source":"telegram","accountId":"acc_default","peerKind":"direct","peerId":"123"}});
}

describe('agent profile', () => {
  beforeEach(() => {
    initializeTestAgentCatalog({
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
      agents: [
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
    });
    seedConversationFixture();
  });

  afterEach(() => closeXopcDatabase());

  it('resolves global defaults and atomic agent overrides', () => {
    const profile = resolveEffectiveAgentProfile('coder');
    expect(profile.primaryModelRef).toBe('anthropic/claude-opus-4-1');
    expect(profile.fallbacks).toEqual([]);
    expect(profile.config.models.intents.review?.primary).toBe('openai/gpt-5.1');
    expect(profile.skillsAllowlist).toEqual(['coding', 'research']);
    expect(profile.config.tools.exec_command).toEqual({ mode: 'allow' });
    expect(profile.config.runtime.maxTurns).toBe(8);
  });

  it('returns provenance for the effective view', () => {
    const resolved = resolveEffectiveAgentConfigForAgent('coder');
    expect(resolved.sources['models.chat.primary']).toBe('agent');
    expect(resolved.sources['models.intents.review.primary']).toBe('global');
    expect(resolved.sources['tools.exec_command.mode']).toBe('agent');
  });

  it('selects the session agent and falls back to the configured default', () => {
    expect(
      resolveEffectiveAgentProfileForSession("06457abd-5401-40e9-8812-7511ee1ffd70").agentId,
    ).toBe('coder');
    expect(() => resolveEffectiveAgentProfileForSession('invalid')).toThrow();
    expect(resolveEffectiveAgentProfileForSession(undefined).agentId).toBe('main');
  });
});
