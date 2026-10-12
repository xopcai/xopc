import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { deleteKnowledgeItem, listKnowledgeItems } from '../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { learnTaskReceipts } from '../task-receipts.js';

const id = '4dffa204-0300-4d2d-89ce-55305490c550';
describe('task receipt memory', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  function seed(source = 'webchat') {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: source, sourceChatId: 'owner', sessionType: 'chat',
      routing: { agentId: 'main', source, accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    const task = new TaskRepository().create({ title: 'Build Atlas', objective: 'Ship Atlas' });
    const runs = new TaskRunRepository();
    const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' },
      trigger: {}, correlationId: 'test', idempotencyKey: 'test-run', contractVersion: 1 });
    getSqliteDatabase().prepare('INSERT INTO task_origin_links(task_id, conversation_id, created_at) VALUES (?, ?, ?)').run(task.id, id, Date.now());
    runs.finalize({ runId: run.id, expectedVersion: run.version, receipt: { status: 'failed', summary: 'Build failed due to missing SDK.',
      changes: [], evidence: [], verification: { status: 'unverified', checks: [] }, remainingWork: ['Install SDK'],
      nextAction: 'Retry build', needsUser: false, completionVerdict: 'not_achieved' } });
  }

  it('retains failure, verification and remaining work without claiming successful completion', () => {
    seed();
    expect(learnTaskReceipts(ConfigSchema.parse({}), () => '/workspace')).toBe(1);
    const memory = listKnowledgeItems()[0]!;
    expect(memory).toMatchObject({ kind: 'task_lesson', claimMode: 'reported', status: 'active' });
    expect(memory.content).toContain('status=failed; verdict=not_achieved');
    expect(memory.content).toContain('Install SDK');
    expect(learnTaskReceipts(ConfigSchema.parse({}), () => '/workspace')).toBe(0);
    deleteKnowledgeItem(memory.id);
    expect(learnTaskReceipts(ConfigSchema.parse({}), () => '/workspace')).toBe(0);
    expect(listKnowledgeItems()).toEqual([]);
  });

  it('does not learn task receipts originating from an unbound channel sender', () => {
    seed('telegram');
    expect(learnTaskReceipts(ConfigSchema.parse({}), () => '/workspace')).toBe(0);
    expect(listKnowledgeItems()).toEqual([]);
  });
});
