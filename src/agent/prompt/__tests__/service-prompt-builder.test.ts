import { describe, expect, it } from 'vitest';

import { SystemPromptBuilder } from '../service-prompt-builder.js';
import { PROMPT_CACHE_BOUNDARY } from '../cache-boundary.js';

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

describe('SystemPromptBuilder cache stability', () => {
  it('places the skill catalog in the stable prefix', () => {
    const builder = new SystemPromptBuilder({
      workspace: '/workspace/default',
      config: {} as never,
      skillManager: {
        getPromptForSkillAllowlist: () => '<available_skills>demo</available_skills>',
      } as never,
    });

    const prompt = builder.build([], { activeProjectContext: '# Active Project\n\nvolatile' });
    const boundary = prompt.indexOf(PROMPT_CACHE_BOUNDARY);
    expect(boundary).toBeGreaterThan(0);
    expect(prompt.indexOf('<available_skills>')).toBeLessThan(boundary);
    expect(prompt.indexOf('# Active Project')).toBeGreaterThan(boundary);
  });
});
