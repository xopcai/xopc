import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../system-prompt.js';

const optionalTools = ['exec_command', 'data_batch', 'tool_search', 'skills_list', 'skill_view',
  'publish_artifacts', 'review_workspace', 'session_status', 'send_message'] as const;

describe('prompt tool capability boundaries', () => {
  it.each([
    [], ['read_file'], ['write_file'], ['skills_list'], ['skill_view'], ['publish_artifacts'],
    ['exec_command', 'review_workspace'], ['review_workspace'], ['data_batch'], ['tool_search'],
    ['session_status'], ['send_message'],
  ])('does not instruct unavailable tools for %j', (...toolNames: string[]) => {
    const prompt = buildSystemPrompt('/ws', { toolNames, channels: ['webchat'], userTimezone: 'Asia/Shanghai' });
    for (const name of optionalTools) {
      if (!toolNames.includes(name)) expect(prompt).not.toContain(name);
    }
    if (!toolNames.includes('apply_patch')) expect(prompt).not.toContain('apply_patch');
  });

  it('requires skill loading only when the loader is available', () => {
    expect(buildSystemPrompt('/ws', { toolNames: ['skills_list'] })).not.toContain('## Skills (mandatory)');
    const prompt = buildSystemPrompt('/ws', { toolNames: ['skill_view'] });
    expect(prompt).toContain('## Skills (mandatory)');
    expect(prompt).toContain('skill_view(name)');
    expect(prompt).not.toContain('skills_list');
  });

  it('retains exact tool names in capability-specific instructions', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: [' SKILL_VIEW ', 'EXEC_COMMAND', 'SESSION_STATUS'], userTimezone: 'Asia/Shanghai' });
    expect(prompt).toContain('SKILL_VIEW(name)');
    expect(prompt).toContain('use `EXEC_COMMAND` with a sufficient timeout');
    expect(prompt).toContain('use `SESSION_STATUS`');
    expect(prompt).not.toContain('skill_view');
  });

  it('publishes files without inventing a shell capability', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: ['publish_artifacts'] });
    expect(prompt).toContain('Publish completed user-facing files with `publish_artifacts`');
    expect(prompt).not.toContain('exec_command.outputs');
  });

  it('chooses proportionate verification without requiring scripts for prose', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: ['read_file', 'write_file', 'exec_command', 'review_workspace'] });
    expect(prompt).toContain('tests for executable behavior, content or layout inspection for documents');
    expect(prompt).toContain('do not create assertion scripts for simple prose edits');
    expect(prompt).toContain('After code changes, use `review_workspace`');
    expect(prompt).not.toContain('verify.test.cjs');
    expect(prompt).not.toContain('run the smallest meaningful assertion test');
  });
});
