import { describe, expect, it } from 'vitest';

import { compactGuide } from '../../../../scripts/conversational-setup-evaluation/compact-guidance.js';
import { conversationalConfigurationGuide } from '../conversational-configuration-guide.js';
import { SystemPromptBuilder } from '../service-prompt-builder.js';

const builder = () => new SystemPromptBuilder({
  workspace: '/workspace/main',
  config: {} as never,
  skillManager: { getPromptForSkillAllowlist: () => '' } as never,
});

describe('Tool-gated conversational configuration guidance', () => {
  it('ships the exact evaluated content', () => {
    expect(conversationalConfigurationGuide).toBe(compactGuide);
  });

  it.each(['main', 'coder', 'researcher'])('includes guidance for %s with the available product tool and preserves caller context', agentId => {
    const prompt = builder().build([], {
      agentId, registeredToolNames: ['xopc_use', 'tool_manual'],
      extraSystemPrompt: 'Caller-provided context.',
      agentProfile: { name: 'Ada' },
    });
    expect(prompt).toContain(conversationalConfigurationGuide);
    expect(prompt).toContain('Caller-provided context.');
    expect(prompt).toContain('Ada');
  });

  it.each([
    { agentId: 'main', registeredToolNames: ['read_file'] },
    { agentId: 'coder', registeredToolNames: ['tool_manual'] },
    { registeredToolNames: [] },
  ])('does not expand guidance outside the evaluated scope: %j', options => {
    expect(builder().build([], options)).not.toContain(conversationalConfigurationGuide);
  });

  it('keeps core safeguards without referring to an unavailable manual tool', () => {
    const prompt = builder().build([], { agentId: 'coder', registeredToolNames: ['xopc_use'] });
    expect(prompt).toContain('agent patch_profile');
    expect(prompt).toContain('Never bypass a denial');
    expect(prompt).toContain('No tool_manual is registered');
    expect(prompt).not.toContain('tool_manual({tool:"xopc_use"');
  });

  it('respects the explicitly disabled system prompt', () => {
    expect(builder().build([], {
      agentId: 'main', registeredToolNames: ['xopc_use'], promptMode: 'none',
    })).not.toContain(conversationalConfigurationGuide);
  });
});
