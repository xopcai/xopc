import { validateToolArguments } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { getTaskHandoff } from '../../../tasks/task-handoff.js';
import { closeXopcDatabase, getSqliteDatabase } from '../../../storage/sqlite/index.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import { TaskCollaborationRepository } from '../../../tasks/task-collaboration-repository.js';
import { buildDelegatedTaskDirective } from '../../../tasks/task-context-assembler.js';
import { createPersonalTaskTool } from '../personal-task-tool.js';

vi.mock('../../../personal-agent/specialist-capabilities.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../personal-agent/specialist-capabilities.js')>(),
  getAvailablePersonalAgentTools: () => ['read_file'],
  personalAgentModelAvailability: () => ({ available: true }),
}));

describe('Personal AI durable delegation', () => {
  afterEach(() => closeXopcDatabase());

  it.each([undefined, 'manual'] as const)('forwards %s acceptance through Personal Agent submission', async acceptancePolicy => {
    const agentId = personalAgentId('local-owner');
    initializeTestAgentCatalog({ agents: [{ id: agentId }, { id: 'researcher' }] });
    const conversation = createConversation({ agentId, customData: { personalAgent: true } }, '/tmp');
    const tool = createPersonalTaskTool({ getCurrentConversationId: () => conversation.key,
      getCurrentAgentId: () => agentId, dispatchTaskRuns: vi.fn() });
    await tool.execute('submit-policy', { command: 'submit', objective: 'Analyze the report',
      description: 'Read the report and give a supported conclusion.', acceptancePolicy });
    expect(new TaskRepository().list()[0]?.contract?.acceptancePolicy).toBe(acceptancePolicy ?? 'verified_auto');
  });

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

  it('finds an older task by its objective and adds a direction only to that task', async () => {
    const agentId = personalAgentId('local-owner');
    initializeTestAgentCatalog({ agents: [{ id: agentId }, { id: 'researcher' }] });
    const createChat = () => createConversation({ agentId, customData: { personalAgent: true } }, '/tmp');
    const conversation = createChat();
    const toolFor = (conversationId: string) => createPersonalTaskTool({
      getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId, dispatchTaskRuns: vi.fn(),
    });
    const tool = toolFor(conversation.key);
    const submit = (target: typeof tool, objective: string) => target.execute(objective, {
      command: 'submit', title: 'Budget report', objective, description: objective,
    });
    await submit(tool, '华东预算及原始单位');
    const east = new TaskOriginRepository().list(conversation.key).items[0].id;
    getSqliteDatabase().prepare('UPDATE tasks SET updated_at = 1 WHERE task_id = ?').run(east);
    for (let index = 0; index < 8; index += 1) await submit(tool, `华南预算 ${index}`);
    const other = toolFor(createChat().key);
    await submit(other, '华东预算及原始单位');

    const directive = buildDelegatedTaskDirective(conversation.key);
    expect(directive).toContain('Showing 8 of 9 tasks');
    expect(directive).not.toContain(east);
    const result = await tool.execute('find-east', { command: 'list', query: '华东预算' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      total: 1, items: [{ id: east, title: 'Budget report', objective: '华东预算及原始单位' }],
    });
    await expect(other.execute('wrong-chat', { command: 'instruct', taskId: east, instruction: 'Keep original units.' }))
      .rejects.toThrow('Task does not belong to this personal conversation');
    insertSessionInput({ id: 'update-east-input', conversationId: conversation.key, clientMessageId: 'update-east',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: '给华东预算那份加一条要求，保留原始单位。', origin: { type: 'system', source: 'cli' } });
    claimNextSessionInput(conversation.key, 'update-east-run');
    const input = { command: 'instruct', taskId: east, instruction: 'Keep original units.' };
    await expect(tool.execute('no-reference', input)).rejects.toThrow('Provide taskReference');
    await expect(tool.execute('ambiguous', { ...input, taskReference: '预算' })).rejects.toThrow('does not identify');
    const south = new TaskOriginRepository().list(conversation.key, 1, { query: '华南预算' }).items[0].id;
    await expect(tool.execute('wrong-target', { ...input, taskId: south, taskReference: '华东预算' })).rejects.toThrow('does not identify');
    await tool.execute('update-east', { ...input, taskReference: '华东预算那份' });
    const board = new TaskCollaborationRepository();
    const tasks = new TaskOriginRepository().list(conversation.key).items;
    expect(tasks).toHaveLength(9);
    expect(tasks.flatMap(task => board.coordination(task.id))).toMatchObject([
      { taskId: east, kind: 'instruction', body: 'Keep original units.' },
    ]);
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
