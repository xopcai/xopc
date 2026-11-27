import { describe, expect, it } from 'vitest';

import { splitPromptCacheBoundary } from '../cache-boundary.js';
import { buildProactiveDataAccessGuide, isProactiveDataAccessAgent } from '../proactive-data-access.js';
import { SystemPromptBuilder } from '../service-prompt-builder.js';

const builder = () => new SystemPromptBuilder({
  workspace: '/workspace/main',
  config: {} as never,
  skillManager: { getPromptForSkillAllowlist: () => '' } as never,
});

describe('Proactive data-access & connector resolution guidance', () => {
  it('enables proactive guidance for main (or configured default) and personal agents only', () => {
    expect(isProactiveDataAccessAgent({ agentId: 'main' })).toBe(true);
    expect(isProactiveDataAccessAgent({ agentId: 'assistant', defaultAgentId: 'assistant' })).toBe(true);
    expect(isProactiveDataAccessAgent({ agentId: 'personal-1', promptRole: 'personal' })).toBe(true);
    expect(isProactiveDataAccessAgent({ agentId: 'coder' })).toBe(false);
    expect(isProactiveDataAccessAgent({ agentId: 'researcher' })).toBe(false);
    expect(isProactiveDataAccessAgent({})).toBe(false);
  });

  it('injects principle-driven agency and judgment guidance into the stable prefix for main without requiring xopc_use', () => {
    const prompt = builder().build([], {
      agentId: 'main',
      registeredToolNames: ['tool_search', 'xopc_require_connection', 'browser_use'],
    });
    const split = splitPromptCacheBoundary(prompt);
    expect(split?.stablePrefix).toContain('## Proactive Problem Solving & Capability Judgment');
    expect(split?.stablePrefix).toContain('Take ownership of the user\'s real goal');
    expect(split?.stablePrefix).toContain('xopc_require_connection');
    expect(split?.stablePrefix).toContain('without asking for pre-confirmation to open the browser');
    expect(split?.stablePrefix).toContain('browser_use(action="request_user")');
    expect(split?.dynamicSuffix).not.toContain('## Proactive Problem Solving & Capability Judgment');
  });

  it('omits the ladder for narrow specialist agents, minimal prompts, and sessions without discovery/browser tools', () => {
    const coderPrompt = builder().build([], {
      agentId: 'coder',
      registeredToolNames: ['tool_search', 'xopc_require_connection', 'browser_use', 'mcp_setup'],
    });
    expect(coderPrompt).not.toContain('## Proactive Problem Solving & Capability Judgment');

    const minimalPrompt = builder().build([], {
      agentId: 'main',
      promptMode: 'minimal',
      registeredToolNames: ['tool_search', 'browser_use'],
    });
    expect(minimalPrompt).not.toContain('## Proactive Problem Solving & Capability Judgment');

    const readOnlyPrompt = builder().build([], {
      agentId: 'main',
      registeredToolNames: ['read_file'],
    });
    expect(readOnlyPrompt).not.toContain('## Proactive Problem Solving & Capability Judgment');
  });

  it('gates individual steps to actually registered tools', () => {
    const noBrowser = buildProactiveDataAccessGuide({
      agentId: 'main',
      toolNames: ['tool_search', 'xopc_require_connection'],
    });
    expect(noBrowser).toContain('xopc_require_connection');
    expect(noBrowser).not.toContain('browser_use');
    expect(noBrowser).not.toContain('mcp_setup');

    const personal = buildProactiveDataAccessGuide({
      agentId: 'personal-1',
      promptRole: 'personal',
      toolNames: ['tool_search', 'browser_use'],
    });
    expect(personal).toBe('');
  });
});
