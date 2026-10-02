import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase,
  resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRepository } from '../task-repository.js';
import { listSidebarTaskGroups } from '../task-sidebar-hierarchy.js';

describe('task sidebar hierarchy', () => {
  let directory: string;
  const parent = '51796408-fbed-45aa-a8bb-2682ae0280dc';
  const worker = 'e8c89d22-a49e-4b43-a563-0f5a75fa3ed7';
  const replacementWorker = 'c81daf0e-2f90-4803-a299-d90d42e9befe';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-task-sidebar-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    ensureSessionRecord(parent, directory, { agentId: 'main' });
    ensureSessionRecord(worker, directory, { agentId: 'worker' });
    ensureSessionRecord(replacementWorker, directory, { agentId: 'worker', name: 'Worker research' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns the task under its parent and excludes its worker from root pagination', () => {
    const task = new TaskRepository().create({ title: 'Research', objective: 'Research' });
    getSqliteDatabase().prepare('INSERT INTO task_origin_links (task_id, conversation_id, created_at) VALUES (?, ?, ?)')
      .run(task.id, parent, Date.now());
    new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId: worker, agentId: 'worker' });

    new TaskConversationRepository().activateExecutionSession({ taskId: task.id,
      conversationId: replacementWorker, agentId: 'worker' });

    expect(listSessionMetadata({ rootConversationsOnly: true }).items.map((session) => session.key)).toEqual([parent]);
    expect(listSidebarTaskGroups([parent])[parent]).toMatchObject({ total: 1, activeCount: 0,
      items: [{ taskId: task.id, title: 'Worker research', activeConversationId: replacementWorker }] });

    getSqliteDatabase().prepare('UPDATE sessions SET hidden_from_session_list = 1 WHERE conversation_id = ?').run(parent);
    expect(listSessionMetadata({ rootConversationsOnly: true }).items.map((session) => session.key)).toContain(worker);
  });
});
