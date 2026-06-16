import { describe, expect, it } from 'vitest';

import { NO_REPLY } from '../../../heartbeat/tokens.js';
import { buildSubagentContextSection, buildSubagentSystemPrompt } from '../subagent-context.js';

describe('buildSubagentContextSection', () => {
  it('includes task and parent-agent rules', () => {
    const section = buildSubagentContextSection({
      goal: 'Fix the bug in auth.ts',
      context: 'See tests/auth.test.ts',
      workspace: '/workspace/main',
      requesterSessionKey: 'agent:main:webchat:direct:u1',
      childSessionKey: 'subagent:task-1',
    });
    expect(section).toContain('# Subagent Context');
    expect(section).toContain('Fix the bug in auth.ts');
    expect(section).toContain('parent agent');
    expect(section).toContain('See tests/auth.test.ts');
    expect(section).toContain(NO_REPLY);
  });
});

describe('buildSubagentSystemPrompt', () => {
  it('builds minimal prompt with tooling and subagent context below boundary', () => {
    const prompt = buildSubagentSystemPrompt({
      goal: 'Summarize README',
      workspace: '/workspace/main',
      toolNames: ['read_file', 'grep'],
    });
    expect(prompt).toContain('## Tooling');
    expect(prompt).toContain('- read_file:');
    expect(prompt).not.toContain('## Memory Recall');
    expect(prompt).toContain('## Subagent Context');
    expect(prompt).toContain('Summarize README');
  });
});
