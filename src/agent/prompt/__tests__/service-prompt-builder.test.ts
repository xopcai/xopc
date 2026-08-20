import { describe, expect, it } from 'vitest';

import { SystemPromptBuilder } from '../service-prompt-builder.js';

describe('SystemPromptBuilder project scope', () => {
  it('keeps the base prompt and project context with custom instructions', () => {
    const builder = new SystemPromptBuilder({
      workspace: '/workspace/default',
      config: {} as never,
      skillManager: {
        getPromptForSkillAllowlist: () => '',
      } as never,
    });

    const prompt = builder.build([], {
      customInstructions: 'You are a focused specialist.',
      activeProjectContext: '# Active Project\n\nProject: xopc',
    });

    expect(prompt).toContain('You are a focused specialist.');
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain('## Response Language');
    expect(prompt).toContain('# Active Project');
    expect(prompt).toContain('Project: xopc');
  });
});
