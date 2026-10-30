import { validateToolArguments } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { getTaskHandoff } from '../../../tasks/task-handoff.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import { createPersonalTaskTool } from '../personal-task-tool.js';

vi.mock('../../../personal-agent/specialist-capabilities.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../personal-agent/specialist-capabilities.js')>(),
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
    expect(tasks[0]!.contract!.expectedOutputs).toEqual(['Compare these reports']);
    expect(tasks[0]!.contract!.acceptanceCriteria).toHaveLength(2);
    expect(new TaskOriginRepository().owns(tasks[0]!.id, conversation.key)).toBe(true);
    expect(new TaskOriginRepository().list(conversation.key).items[0]).toMatchObject({ operationalState: 'queued' });
    expect(dispatchTaskRuns).toHaveBeenCalledOnce();

    await tool.execute('retry', input);
    expect(new TaskRepository().list()).toHaveLength(1);
    expect(new TaskRunRepository().listByTask(tasks[0]!.id)).toHaveLength(1);
  });
  it('copies only the active original input verbatim and remains idempotent', async () => {
    const agentId = personalAgentId('local-owner');
    initializeTestAgentCatalog({agents:[{id:agentId},{id:'researcher'}]});
    const conversation = createConversation({agentId,customData:{personalAgent:true}},'/tmp');
    const content = 'Compare the reports. Preserve 0.016667 and 未公开. Do not send messages.\nExact marker: KEEP-原文';
    insertSessionInput({id:'input-original',conversationId:conversation.key,clientMessageId:'request',requestedDelivery:'next',effectiveDelivery:'next',status:'queued',content,origin:{type:'system',source:'cli'}});
    claimNextSessionInput(conversation.key,'run');
    const tool = createPersonalTaskTool({getCurrentConversationId:()=>conversation.key,getCurrentAgentId:()=>agentId,dispatchTaskRuns:vi.fn()});
    const args={command:'submit' as const,objective:'Compare the reports',useOriginalRequest:true};
    const first = await tool.execute('first',args);
    expect((first.content[0] as {text:string}).text).toContain('"ok": true');
    await tool.execute('retry',args);
    const tasks = new TaskRepository().list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].body).toContain(content);
    expect(getTaskHandoff(tasks[0].id)?.originalRequest).toBe(content);
    const state = await tool.execute('revision-state', {command:'get',taskId:tasks[0].id,section:'revision'});
    const stateText = (state.content[0] as {text:string}).text;
    expect(JSON.parse(stateText).revisionBaseline).toBeUndefined();
    expect(stateText).toContain('never invent baseline fields');
    const direction = await tool.execute('new-direction', {command:'instruct',taskId:tasks[0].id,instruction:'Also retain the original units.'});
    expect((direction.content[0] as {text:string}).text).toContain('instruction');
    expect(new TaskRepository().list()).toHaveLength(1);

  });
  it('rejects original-input mode without an active input rather than guessing from history', async () => {
    const agentId = personalAgentId('local-owner');
    initializeTestAgentCatalog({agents:[{id:agentId}]});
    const conversation = createConversation({agentId,customData:{personalAgent:true}},'/tmp');
    const tool = createPersonalTaskTool({getCurrentConversationId:()=>conversation.key,getCurrentAgentId:()=>agentId,dispatchTaskRuns:vi.fn()});
    await expect(tool.execute('missing',{command:'submit',objective:'Do work',useOriginalRequest:true})).rejects.toThrow('active original user request is unavailable');
    expect(new TaskRepository().list()).toHaveLength(0);
  });

  it('advertises a plain required command enum and rejects an omitted command before execution', () => {
    const tool = createPersonalTaskTool({});
    const check = (args: Record<string, unknown>) => validateToolArguments(tool,{id:'schema',name:tool.name,arguments:args});
    expect(check({command:'submit',objective:'Analyze',useOriginalRequest:true})).toMatchObject({command:'submit'});
    expect(()=>check({objective:'Analyze',useOriginalRequest:true})).toThrow('command');
    expect(()=>check({command:'submit',objective:'Analyze'})).toThrow('Validation failed');
    expect(()=>check({command:'cancel',objective:'Analyze',useOriginalRequest:true})).toThrow('Validation failed');
    expect(()=>check({command:'not-a-command',objective:'Analyze',useOriginalRequest:true})).toThrow('Validation failed');
    expect(tool.parameters.properties.command).toMatchObject({type:'string',enum:expect.arrayContaining(['submit','cancel'])});
  });

});
