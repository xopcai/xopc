import { describe, expect, it } from 'vitest';

import { SystemPromptBuilder } from '../service-prompt-builder.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { personalInstructions } from '../../../personal-agent/prompts.js';
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

describe('SystemPromptBuilder runtime responsibility', () => {
  it('uses coordination rules only for the actual personal conversation', () => {
    requireXopcDatabase();
    const agentId = personalAgentId('local-owner');
    const personal = createConversation({ agentId, customData: { personalAgent: true },
      routing: { agentId, source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } }).key;
    const worker = createConversation({ agentId,
      routing: { agentId, source: 'subagent', accountId: 'default', peerKind: 'direct', peerId: 'worker' } }).key;
    const builder = new SystemPromptBuilder({ workspace: '/workspace', config: {} as never,
      skillManager: { getPromptForSkillAllowlist: () => '' } as never });
    const prompt = builder.build([], { conversationId: personal, customInstructions: personalInstructions({}),
      registeredToolNames: ['personal_task', 'personal_request', 'read_file', 'personal_result'],
      agentProfile: { name: 'Coordinator' } });
    expect(prompt).toContain('## Personal Coordination');
    expect(prompt).toContain('Submit before reading materials');
    expect(prompt).toContain('Do not wait, poll, or continue executing the delegated work');
    expect(prompt).toContain('Submission is not completion');
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain('## Action Trust Boundary');
    expect(prompt).toContain('## Response Language');
    expect(prompt).toContain('## Human Collaboration');
    expect(prompt).not.toContain('## Execution Bias');
    expect(prompt).not.toContain('## Problem Solving');
    expect(prompt).not.toContain('### Task Contract');
    expect(prompt).not.toContain('## Work Continuity');
    expect(prompt).not.toContain('Read named inputs directly. Search only if missing');
    expect(prompt).not.toContain('Continue until done or genuinely blocked');

    const workerPrompt = builder.build([], { conversationId: worker, registeredToolNames: ['read_file'] });
    expect(workerPrompt).not.toContain('## Personal Coordination');
    const fullWorkerPrompt = builder.build([], { conversationId: worker, promptMode: 'full', registeredToolNames: ['read_file'] });
    expect(fullWorkerPrompt).toContain('## Execution Bias');
    expect(fullWorkerPrompt).toContain('## Problem Solving');
    expect(fullWorkerPrompt).toContain('### Task Contract');
    expect(fullWorkerPrompt).toContain('Read named inputs directly. Search only if missing');
    expect(fullWorkerPrompt).not.toContain('## Personal Coordination');
  });
});
