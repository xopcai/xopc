import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../../../providers/model-call.js', () => ({ completeWithResolvedCredentials: complete }));
vi.mock('../../../providers/index.js', () => ({ resolveModel: () => ({ provider: 'test' }), getApiKey: async () => 'test' }));

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, appendTranscriptEntry, resetSessionRecord } from '../../../storage/sqlite/index.js';
import { insertSessionInput, claimNextSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { SessionStore } from '../../../session/store.js';
import { ConfigSchema } from '../../../config/schema.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskJudgeService } from '../task-judge-service.js';
import { getTaskContinuation } from '../../../tasks/task-continuation.js';

// Only the verifier response is scripted. Task lifecycle, budgets, waits and receipts use SQLite.
describe('task acceptance continuation', () => {
  let root: string;
  let runId: string;
  let conversationId: string;
  let service: TaskJudgeService;
  const runs = new TaskRunRepository();
  beforeEach(() => {
    complete.mockReset();root = mkdtempSync(join(tmpdir(), 'xopc-judge-continuation-'));
    resetXopcDatabaseSingletonForTest();openXopcDatabase({ path: join(root, 'xopc.db') });seedTestAgentCatalog();
    conversationId = createConversation({ agentId: 'main' }).key;
    const created = new TaskApplicationService().create({ idempotencyKey: 'judge-task', title: 'Finish report', priority: 'normal',
      contract: { objective: 'Finish report', acceptanceCriteria: ['Complete report'], expectedOutputs: [], constraints: [], assumptions: [], risks: [],
        approvalRequired: [], acceptancePolicy: 'verified_auto', outputDestinations: [] }, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('TaskRun was not created');runId = created.runId;
    new TaskConversationRepository().activateExecutionSession({ taskId: created.model.task.id, conversationId, agentId: 'main', runId });
    const queued = runs.require(runId);const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: runId, query: 'report' });
    runs.start({ runId, expectedVersion: queued.version, contextSnapshotId: snapshot.id, policySnapshot: {}, conversationId, timeoutAt: Date.now() + 60_000 });
    appendTranscriptEntry(conversationId, { role: 'user', content: 'Finish report', timestamp: 1 });
    service = new TaskJudgeService({ sessionStore: new SessionStore({ config: ConfigSchema.parse({}) }),
      modelManager: { getModelForSession: () => 'test/model' } as never, getConfig: () => undefined });
  });
  afterEach(() => { closeXopcDatabase();resetXopcDatabaseSingletonForTest();rmSync(root, { recursive: true, force: true }); });
  const review = () => ({ channel: 'webchat', chatId: 'test', assistantPlainText: 'First part finished', aborted: false });
  function decision(completedCriteria: number[], needsUser = false) {
    complete.mockResolvedValue({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ completedCriteria, needsUser,
      nextAction: 'Finish the remaining section', recommendation: 'Continue report', reasons: ['Evidence incomplete'] }) }] });
  }
  it('continues incomplete acceptance twice and reports remaining work when its budget is exhausted', async () => {
    decision([]);
    for (let index = 0; index < 3; index++) {
      await service.reviewTurn({ ...review(), conversationId });
      const run = runs.require(runId);
      if (index < 2) {
        expect(run.status).toBe('waiting');expect(runs.getReceipt(runId)).toBeUndefined();
        expect(run.policySnapshot.continuationAttempts).toBe(index + 1);
        runs.setStatus({ runId, expectedVersion: run.version, from: ['waiting'], to: 'running' });
      } else {
        expect(run.status).toBe('succeeded');expect(runs.getReceipt(runId)).toMatchObject({ completionVerdict: 'partial', remainingWork: ['Complete report'] });
      }
    }
  });
  it('finishes after a continuation satisfies acceptance', async () => {
    decision([]);await service.reviewTurn({ ...review(), conversationId });
    const waiting = runs.require(runId);runs.setStatus({ runId, expectedVersion: waiting.version, from: ['waiting'], to: 'running' });
    decision([0]);await service.reviewTurn({ ...review(), conversationId });
    expect(runs.getReceipt(runId)).toMatchObject({ completionVerdict: 'achieved', remainingWork: [], verification: { status: 'passed' } });
  });
  it('keeps a required user decision as a wait instead of automatically continuing', async () => {
    decision([], true);await service.reviewTurn({ ...review(), conversationId });
    expect(runs.require(runId).policySnapshot.continuationAttempts).toBeUndefined();
    expect(runs.listActiveWaits(runs.require(runId).taskId)).toHaveLength(1);
  });
  it('rejects a stale recovery plan after the execution transcript is reset', async () => {
    decision([]);await service.reviewTurn({ ...review(), conversationId });
    const waiting = runs.require(runId);runs.setStatus({ runId, expectedVersion: waiting.version, from: ['waiting'], to: 'running' });
    const executionId = crypto.randomUUID();
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'recovery', taskRunId: runId,
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Continue', origin: { type: 'system', source: 'workflow' } });
    claimNextSessionInput(conversationId, executionId);
    expect(getTaskContinuation(conversationId, executionId)?.message).toContain('Remaining acceptance criteria');
    resetSessionRecord(conversationId, root);
    expect(() => getTaskContinuation(conversationId, executionId)).toThrow('execution transcript changed');
  });
  it('resumes verification after transient verifier requests are exhausted', async () => {
    complete.mockRejectedValue(new Error('503 Service Unavailable'));
    await service.reviewTurn({ ...review(), conversationId });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(runs.require(runId)).toMatchObject({ status: 'waiting', policySnapshot: {
      continuationAttempts: 1, continuation: { reason: 'acceptance_check_failed' } } });
    expect(runs.getReceipt(runId)).toBeUndefined();
  });
});
