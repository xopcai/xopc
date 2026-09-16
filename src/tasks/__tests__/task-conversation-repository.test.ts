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
    const first = "a80f4d23-f6d2-4560-8eef-291df513a97a";
    const second = "e3aba04b-4bff-4722-843d-661134acbff9";
    ensureSessionRecord(first, stateDir, { agentId: "a" });
    ensureSessionRecord(second, stateDir, { agentId: "b" });
    const conversations = new TaskConversationRepository();

    conversations.activateExecutionSession({ taskId: task.id, conversationId: first, agentId: 'a' });
    conversations.activateExecutionSession({ taskId: task.id, conversationId: second, agentId: 'b' });

    expect(conversations.getState(task.id)).toMatchObject({
      activeConversationId: second,
      currentExecutorAgentId: 'b',
      assignmentEpoch: 2,
    });
    expect(conversations.listSessions(task.id)).toEqual([
      expect.objectContaining({ conversationId: second, status: 'active', assignmentEpoch: 2 }),
      expect.objectContaining({ conversationId: first, status: 'superseded', assignmentEpoch: 1 }),
    ]);
    expect(conversations.resolveActiveExecutionSession(first)).toBeUndefined();
    expect(conversations.resolveActiveExecutionSession(second)?.taskId).toBe(task.id);
  });

  it('does not allow an execution session to belong to two tasks', () => {
    const firstTask = createTask('task-1');
    const secondTask = createTask('task-2');
    const conversationId = "1971167b-f7ff-40ce-8282-4920b14444cb";
    ensureSessionRecord(conversationId, stateDir, { agentId: "a" });
    const conversations = new TaskConversationRepository();
    conversations.activateExecutionSession({ taskId: firstTask.id, conversationId, agentId: 'a' });

    expect(() => conversations.activateExecutionSession({
      taskId: secondTask.id,
      conversationId,
      agentId: 'a',
    })).toThrow();
  });

  it('switches executors atomically and returns the same handoff for a retry', () => {
    const task = createTask('task-handoff');
    const first = "b4d2ba55-51a7-4aba-88ac-781c617eefb5";
    const second = "c74da057-9ded-428a-83b6-a8a5bf1f4f6a";
    ensureSessionRecord(first, stateDir, { agentId: "a" });
    ensureSessionRecord(second, stateDir, { agentId: "b" });
    const conversations = new TaskConversationRepository();
    conversations.activateExecutionSession({ taskId: task.id, conversationId: first, agentId: 'a' });

    const input = {
      taskId: task.id,
      expectedTaskVersion: task.version,
      toConversationId: second,
      toAgentId: 'b',
      idempotencyKey: 'handoff-once',
      payload: { objective: 'Complete task-handoff', remainingWork: ['verify'] },
      now: 100,
    };
    const firstResult = conversations.completeHandoff(input);
    const retryResult = conversations.completeHandoff(input);

    expect(retryResult.snapshot.id).toBe(firstResult.snapshot.id);
    expect(conversations.getState(task.id)).toMatchObject({
      activeConversationId: second,
      currentExecutorAgentId: 'b',
      assignmentEpoch: 2,
    });
    expect(new TaskRepository().require(task.id)).toMatchObject({
      delegateAgentId: 'b',
      version: task.version + 1,
    });
  });
});
