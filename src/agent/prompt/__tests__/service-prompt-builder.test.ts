import { describe, expect, it } from 'vitest';

import { SystemPromptBuilder } from '../service-prompt-builder.js';

describe('SystemPromptBuilder project scope', () => {
  it('keeps active project context when the agent overrides its base prompt', () => {
    const builder = new SystemPromptBuilder({
      workspace: '/workspace/default',
      config: {} as never,
      skillManager: {
        getPromptForSkillAllowlist: () => '',
      } as never,
    });

    const prompt = builder.build([], {
      systemPromptOverride: 'You are a focused specialist.',
      activeProjectContext: '# Active Project\n\nProject: xopc',
    });

    expect(prompt).toContain('You are a focused specialist.');
    expect(prompt).toContain('# Active Project');
    expect(prompt).toContain('Project: xopc');
  });
});
