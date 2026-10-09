import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import { createPersonalTaskTool } from '../personal-task-tool.js';

vi.mock('../../../personal-agent/specialist-capabilities.js', () => ({
  getAvailablePersonalAgentTools: () => ['read_file'],
  personalAgentModelAvailability: () => ({ available: true }),
}));

describe('Personal AI durable delegation', () => {
  afterEach(() => closeXopcDatabase());

  it('persists the requested specialist, Skill and materials and queues execution once', async () => {
    const agentId = personalAgentId('local-owner');
    initializeTestAgentCatalog({ agents: [{ id: agentId }, { id: 'researcher' }] });
    const conversation = createConversation({ agentId, customData: { personalAgent: true } }, '/tmp');
    const dispatchTaskRuns = vi.fn();
    const tool = createPersonalTaskTool({
      getCurrentConversationId: () => conversation.key, getCurrentAgentId: () => agentId,
      dispatchTaskRuns,
      getAgentSkillAvailability: () => ({ skills: [{ name: 'research', availableForCurrentAgent: true }] }),
    });
    const input = { command: 'create' as const, agentId: 'researcher', objective: 'Compare these reports',
      description: 'Read the complete /workspace/reports/full.pdf and cite the source.',
      requiredSkills: ['research'], idempotencyKey: 'explicit-research-request' };
    await tool.execute('create', input);
    const tasks = new TaskRepository().list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ delegateAgentId: 'researcher', phase: 'active' });
    expect(tasks[0]!.body).toContain('/workspace/reports/full.pdf');
    expect(tasks[0]!.body).toContain('## Required Skills\n\n- research');
    expect(new TaskOriginRepository().owns(tasks[0]!.id, conversation.key)).toBe(true);
    expect(new TaskOriginRepository().list(conversation.key).items[0]).toMatchObject({ operationalState: 'queued' });
    expect(dispatchTaskRuns).toHaveBeenCalledOnce();

    await tool.execute('retry', input);
    expect(new TaskRepository().list()).toHaveLength(1);
    expect(new TaskRunRepository().listByTask(tasks[0]!.id)).toHaveLength(1);
  });
});
