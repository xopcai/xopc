import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRepository } from '../task-repository.js';

function createTask(id: string) {
  return new TaskRepository().create({
    id,
    idempotencyKey: id,
    title: id,
    objective: `Complete ${id}`,
  });
}

describe('TaskConversationRepository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-conversation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps exactly one active execution session while retaining history', () => {
    const task = createTask('task-1');
    const first = 'agent:a:webchat:default:direct:first';
    const second = 'agent:b:webchat:default:direct:second';
    ensureSessionRecord(first, stateDir);
    ensureSessionRecord(second, stateDir);
    const conversations = new TaskConversationRepository();

    conversations.activateExecutionSession({ taskId: task.id, sessionKey: first, agentId: 'a' });
    conversations.activateExecutionSession({ taskId: task.id, sessionKey: second, agentId: 'b' });

    expect(conversations.getState(task.id)).toMatchObject({
      activeSessionKey: second,
      currentExecutorAgentId: 'b',
      assignmentEpoch: 2,
    });
    expect(conversations.listSessions(task.id)).toEqual([
      expect.objectContaining({ sessionKey: second, status: 'active', assignmentEpoch: 2 }),
      expect.objectContaining({ sessionKey: first, status: 'superseded', assignmentEpoch: 1 }),
    ]);
    expect(conversations.resolveActiveExecutionSession(first)).toBeUndefined();
    expect(conversations.resolveActiveExecutionSession(second)?.taskId).toBe(task.id);
  });

  it('does not allow an execution session to belong to two tasks', () => {
    const firstTask = createTask('task-1');
    const secondTask = createTask('task-2');
    const sessionKey = 'agent:a:webchat:default:direct:exclusive';
    ensureSessionRecord(sessionKey, stateDir);
    const conversations = new TaskConversationRepository();
    conversations.activateExecutionSession({ taskId: firstTask.id, sessionKey, agentId: 'a' });

    expect(() => conversations.activateExecutionSession({
      taskId: secondTask.id,
      sessionKey,
      agentId: 'a',
    })).toThrow();
  });

  it('switches executors atomically and returns the same handoff for a retry', () => {
    const task = createTask('task-handoff');
    const first = 'agent:a:webchat:default:direct:handoff-first';
    const second = 'agent:b:webchat:default:direct:handoff-second';
    ensureSessionRecord(first, stateDir);
    ensureSessionRecord(second, stateDir);
    const conversations = new TaskConversationRepository();
    conversations.activateExecutionSession({ taskId: task.id, sessionKey: first, agentId: 'a' });

    const input = {
      taskId: task.id,
      expectedTaskVersion: task.version,
      toSessionKey: second,
      toAgentId: 'b',
      idempotencyKey: 'handoff-once',
      payload: { objective: 'Complete task-handoff', remainingWork: ['verify'] },
      now: 100,
    };
    const firstResult = conversations.completeHandoff(input);
    const retryResult = conversations.completeHandoff(input);

    expect(retryResult.snapshot.id).toBe(firstResult.snapshot.id);
    expect(conversations.getState(task.id)).toMatchObject({
      activeSessionKey: second,
      currentExecutorAgentId: 'b',
      assignmentEpoch: 2,
    });
    expect(new TaskRepository().require(task.id)).toMatchObject({
      delegateAgentId: 'b',
      version: task.version + 1,
    });
  });
});
