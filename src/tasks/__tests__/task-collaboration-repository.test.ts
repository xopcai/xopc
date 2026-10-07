import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { TaskRepository } from '../task-repository.js';
import { TaskCollaborationRepository } from '../task-collaboration-repository.js';
import { TaskCollaborationDelivery } from '../task-collaboration-delivery.js';
import { TaskMainUpdateDelivery } from '../task-main-update-delivery.js';
import { applyTaskMainUpdatePreference, parseTaskMainUpdateDecision } from '../task-main-update-decision-service.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskMainAgentRepository } from '../task-main-agent-repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { insertSessionInput, listTaskUpdateTriggers } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

describe('TaskCollaborationRepository', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-collaboration-'));
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps a per-task ordered board and one durable delivery per instruction', () => {
    const task = new TaskRepository().create({ title: 'Research', objective: 'Research options' });
    const board = new TaskCollaborationRepository();
    const first = board.append({ taskId: task.id, authorKind: 'main_agent', authorId: 'main',
      kind: 'instruction', body: 'Check option A', idempotencyKey: 'first', deliverToWorker: true });
    expect(board.append({ taskId: task.id, authorKind: 'main_agent', authorId: 'main',
      kind: 'instruction', body: 'Check option A', idempotencyKey: 'first', deliverToWorker: true })).toEqual(first);
    expect(() => board.append({ taskId: task.id, authorKind: 'main_agent', authorId: 'main',
      kind: 'instruction', body: 'Different content', idempotencyKey: 'first' })).toThrow(/Idempotency/);
    const second = board.append({ taskId: task.id, authorKind: 'worker_agent', authorId: 'researcher',
      kind: 'progress', body: 'Found two options', idempotencyKey: 'second' });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(board.list(task.id, 1).map((entry) => entry.id)).toEqual([second.id]);
    expect(board.pendingDeliveries()).toMatchObject([{ entry: { id: first.id, deliveryStatus: 'pending' } }]);
    board.markDelivered(first.id, 'worker-conversation', 1);
    expect(board.get(first.id)?.deliveryStatus).toBe('delivered');
    board.markConfirmed(first.id);
    expect(board.get(first.id)?.deliveryStatus).toBe('confirmed');
    expect(board.pendingDeliveries()).toEqual([]);
  });

  it('resumes a waiting TaskRun from a board answer without submitting a second Agent turn', async () => {
    const contract = { objective: 'Research', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
      outputDestinations: [] };
    const created = new TaskApplicationService().create({ idempotencyKey: 'answer-task', title: 'Research',
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!created.ok || !created.runId) throw new Error('Expected TaskRun');
    const conversation = createConversation({ agentId: 'worker' });
    new TaskConversationRepository().activateExecutionSession({ taskId: created.model.task.id,
      conversationId: conversation.key, agentId: 'worker', runId: created.runId });
    const runs = new TaskRunRepository();
    const question = new TaskCollaborationRepository().append({ taskId: created.model.task.id,
      taskRunId: created.runId, authorKind: 'worker_agent', authorId: 'worker', kind: 'question',
      body: 'Which source?', idempotencyKey: 'question' });
    const wait = runs.createWait({ taskId: created.model.task.id, taskRunId: created.runId,
      kind: 'external_event', reason: 'Which source?', condition: { collaborationEntryId: question.id } });
    const answer = new TaskCollaborationRepository().append({ taskId: created.model.task.id,
      authorKind: 'main_agent', authorId: 'main', kind: 'answer', body: 'Use source A',
      causationId: question.id, idempotencyKey: 'answer', deliverToWorker: true });
    insertSessionInput({ id: 'executing-input', conversationId: conversation.key,
      clientMessageId: `task:${created.runId}`, requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Research', taskRunId: created.runId,
      origin: { type: 'system', source: 'workflow' } });
    expect(runs.nextAgentInputClientMessageId(created.runId)).toBe(`task:${created.runId}`);
    const submit = vi.fn(async () => true);
    expect(await new TaskCollaborationDelivery().drain(submit)).toBe(0);
    expect(runs.requireWait(wait.id).status).toBe('active');
    getSqliteDatabase().prepare("UPDATE session_inputs SET status = 'completed' WHERE id = ?")
      .run('executing-input');
    expect(runs.nextAgentInputClientMessageId(created.runId)).toBe(`task:${created.runId}:resume:1`);
    getSqliteDatabase().prepare('UPDATE task_collaboration_deliveries SET updated_at = 0 WHERE entry_id = ?')
      .run(answer.id);
    expect(await new TaskCollaborationDelivery().drain(submit)).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    expect(runs.requireWait(wait.id).status).toBe('resolved');
    expect(new TaskCollaborationRepository().get(answer.id)?.deliveryStatus).toBe('delivered');
  });

  it('always routes worker questions to the task owner', async () => {
    const owner = createConversation({ agentId: 'main' });
    const created = new TaskApplicationService().create({
      idempotencyKey: 'owner-question', title: 'Write an update', priority: 'normal',
      contract: { objective: 'Write an update', expectedOutputs: [], acceptanceCriteria: [],
        constraints: [], approvalRequired: [], assumptions: [], risks: [],
        acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], originConversationId: owner.key,
      activation: { mode: 'capture', phase: 'backlog' },
    });
    if (!created.ok) throw new Error('Expected Task');
    const question = new TaskCollaborationRepository().append({ taskId: created.model.task.id,
      authorKind: 'worker_agent', authorId: 'writer', kind: 'question',
      body: 'Which audience?', idempotencyKey: 'worker-question' });
    const decide = vi.fn(async () => ({ notify: false, reason: 'quiet', userPreference: 'final_only' as const }));
    const submitAndConfirm = vi.fn(async (_message: { conversationId: string; clientMessageId: string; content: string }) => true);
    expect(await new TaskMainUpdateDelivery().drain({ isAvailable: () => true, decide, submitAndConfirm })).toBe(1);
    expect(decide).not.toHaveBeenCalled();
    expect(submitAndConfirm.mock.calls[0]?.[0].content).toContain(question.id);
  });

  it('shows the newest board update to the worker after a long collaboration history', () => {
    const task = new TaskRepository().create({ title: 'Research', objective: 'Research options' });
    const board = new TaskCollaborationRepository();
    for (let index = 1; index <= 55; index += 1) {
      board.append({ taskId: task.id, authorKind: 'system', authorId: 'test', kind: 'progress',
        body: `Update ${index}`, idempotencyKey: `update-${index}` });
    }
    expect(board.recent(task.id, undefined, 12).at(-1)?.body).toBe('Update 55');
  });

  it('keeps the main Agent task owner when the origin conversation is removed', () => {
    const main = createConversation({ agentId: 'main' });
    const contract = { objective: 'Research', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
      outputDestinations: [] };
    const created = new TaskApplicationService().create({ idempotencyKey: 'durable-owner-task', title: 'Research',
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      originConversationId: main.key, activation: { mode: 'capture', phase: 'backlog' } });
    if (!created.ok) throw new Error('Expected Task');
    const owner = new TaskMainAgentRepository();
    expect(owner.get(created.model.task.id)).toMatchObject({
      agentId: 'main', originConversationId: main.key,
    });
    getSqliteDatabase().prepare('DELETE FROM sessions WHERE conversation_id = ?').run(main.key);
    expect(owner.get(created.model.task.id)).toMatchObject({
      agentId: 'main', originConversationId: main.key,
    });
  });

  it('lets the main Agent hold routine progress and notify about the final result', async () => {
    const main = createConversation({ agentId: 'main' });
    const contract = { objective: 'Research', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
      outputDestinations: [] };
    const created = new TaskApplicationService().create({ idempotencyKey: 'main-update-task', title: 'Research',
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      originConversationId: main.key, activation: { mode: 'capture', phase: 'backlog' } });
    if (!created.ok) throw new Error('Expected Task');
    const board = new TaskCollaborationRepository();
    board.append({ taskId: created.model.task.id, authorKind: 'main_agent', authorId: 'main',
      kind: 'instruction', body: 'Start research', idempotencyKey: 'instruction' });
    const progress = board.append({ taskId: created.model.task.id, authorKind: 'worker_agent', authorId: 'worker',
      kind: 'progress', body: 'Halfway done', idempotencyKey: 'progress' });
    const secondProgress = board.append({ taskId: created.model.task.id, authorKind: 'worker_agent', authorId: 'worker',
      kind: 'progress', body: 'Calculation done', idempotencyKey: 'progress-2' });
    const result = board.append({ taskId: created.model.task.id, authorKind: 'system', authorId: 'task-run',
      kind: 'result', body: 'Research complete', idempotencyKey: 'result' });
    expect(board.pendingMainUpdates().map(({ entry }) => entry.id)).toEqual([result.id, progress.id, secondProgress.id]);
    let confirm!: () => void;
    const confirmed = new Promise<void>((resolve) => { confirm = resolve; });
    const submit = vi.fn(async () => { await confirmed; return true; });
    const decide = vi.fn(async ({ entry }: { entry: { kind: string } }) => ({
      notify: entry.kind === 'result', reason: entry.kind === 'result' ? 'The user is awaiting the result' : 'Routine progress',
      userPreference: 'final_only' as const,
    }));
    const delivery = new TaskMainUpdateDelivery();
    expect(await delivery.drain({ isAvailable: () => false, decide, submitAndConfirm: submit })).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    getSqliteDatabase().prepare('UPDATE task_main_update_deliveries SET updated_at = 0').run();
    const draining = delivery.drain({ isAvailable: () => true, decide, submitAndConfirm: submit });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(board.pendingMainUpdates().some(({ entry }) => entry.id === result.id)).toBe(true);
    confirm();
    expect(await draining).toBe(3);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: main.key, clientMessageId: `task-main-update:${result.id}`,
    }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(board.pendingMainUpdates()).toEqual([]);
    const decisions = getSqliteDatabase().prepare(`SELECT entry_id, decision FROM task_main_update_deliveries
      ORDER BY decided_at, entry_id`).all() as Array<{ entry_id: string; decision: string }>;
    expect(decisions.find((item) => item.entry_id === progress.id)?.decision).toBe('silent');
    expect(decisions.find((item) => item.entry_id === result.id)?.decision).toBe('notify');
  });

  it('prioritizes blocking questions over a burst of progress updates', () => {
    const main = createConversation({ agentId: 'main' });
    const contract = { objective: 'Research', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
      outputDestinations: [] };
    const created = new TaskApplicationService().create({ idempotencyKey: 'priority-task', title: 'Research',
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      originConversationId: main.key, activation: { mode: 'capture', phase: 'backlog' } });
    if (!created.ok) throw new Error('Expected Task');
    const board = new TaskCollaborationRepository();
    for (let index = 0; index < 30; index += 1) board.append({ taskId: created.model.task.id,
      authorKind: 'worker_agent', authorId: 'worker', kind: 'progress', body: `Progress ${index}`,
      idempotencyKey: `progress-${index}` });
    const question = board.append({ taskId: created.model.task.id, authorKind: 'worker_agent',
      authorId: 'worker', kind: 'question', body: 'Which source should I use?', idempotencyKey: 'question' });
    expect(board.pendingMainUpdates(20)[0]?.entry.id).toBe(question.id);
  });

  it('does not suppress an update that was already submitted to the main conversation', async () => {
    const main = createConversation({ agentId: 'main' });
    const contract = { objective: 'Research', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
      outputDestinations: [] };
    const created = new TaskApplicationService().create({ idempotencyKey: 'submitted-update-task', title: 'Research',
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      originConversationId: main.key, activation: { mode: 'capture', phase: 'backlog' } });
    if (!created.ok) throw new Error('Expected Task');
    const board = new TaskCollaborationRepository();
    const progress = board.append({ taskId: created.model.task.id, authorKind: 'worker_agent',
      authorId: 'worker', kind: 'progress', body: 'Started', idempotencyKey: 'progress' });
    board.append({ taskId: created.model.task.id, authorKind: 'system', authorId: 'task-run',
      kind: 'result', body: 'Submitted', idempotencyKey: 'result' });
    insertSessionInput({ id: 'submitted-update-input', conversationId: main.key,
      clientMessageId: `task-main-update:${progress.id}`, requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'completed', content: 'Update',
      origin: { type: 'system', source: 'task_update' } });
    expect(board.hasSubmittedMainUpdate(progress.id)).toBe(true);
    expect(board.hasNewerMainUpdate(progress.taskId, progress.sequence)).toBe(true);
    const decide = vi.fn(async () => ({ notify: false, reason: 'Already visible', userPreference: 'updates' as const }));
    await new TaskMainUpdateDelivery().drain({ isAvailable: () => true, decide,
      submitAndConfirm: async () => true });
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it('resolves task update provenance from a durable run without exposing board text', () => {
    const main = createConversation({ agentId: 'main' });
    const task = new TaskRepository().create({ title: 'Check prices', objective: 'Verify sources' });
    const entry = new TaskCollaborationRepository().append({ taskId: task.id,
      authorKind: 'worker_agent', authorId: 'worker', kind: 'result',
      body: 'Private worker details', idempotencyKey: 'result' });
    insertSessionInput({ id: 'task-trigger-input', conversationId: main.key,
      clientMessageId: `task-main-update:${entry.id}:retry:1`, requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'completed', content: 'Private prompt',
      origin: { type: 'system', source: 'task_update' } });
    getSqliteDatabase().prepare('UPDATE session_inputs SET run_id = ? WHERE id = ?')
      .run('task-trigger-run', 'task-trigger-input');
    expect(listTaskUpdateTriggers(main.key).get('task-trigger-run')).toEqual({
      entryId: entry.id, taskId: task.id, taskTitle: 'Check prices', kind: 'result',
    });
    expect(JSON.stringify(listTaskUpdateTriggers(main.key))).not.toContain('Private worker details');
  });

  it('accepts only explicit Agent notification decisions', () => {
    expect(parseTaskMainUpdateDecision('{"notify":false,"userPreference":"final_only","reason":"No meaningful change"}'))
      .toEqual({ notify: false, userPreference: 'final_only', reason: 'No meaningful change' });
    expect(() => parseTaskMainUpdateDecision('{"reason":"missing choice"}')).toThrow(/incomplete/);
    expect(applyTaskMainUpdatePreference({ notify: true, userPreference: 'final_only', reason: 'Worker claims done' },
      'progress')).toMatchObject({ notify: false });
    expect(applyTaskMainUpdatePreference({ notify: true, userPreference: 'final_only', reason: 'Verified result' },
      'result')).toMatchObject({ notify: true });
  });
});
