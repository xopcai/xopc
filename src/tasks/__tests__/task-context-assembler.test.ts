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
import { buildTaskExecutionDirective } from '../task-context-assembler.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRepository } from '../task-repository.js';

describe('task context assembler', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('resolves task context from the durable session link when session metadata is missing', () => {
    const task = new TaskRepository().create({
      idempotencyKey: 'linked-session-context',
      title: 'Keep task context in chat',
      objective: 'Keep the correct task context after opening chat full screen',
      expectedOutputs: ['Task banner and execution context'],
      acceptanceCriteria: ['The full-screen chat remains task-bound'],
    });
    const conversationId = "64fbc4ed-bd4b-49ee-80d6-189f7ffd779a";
    ensureSessionRecord(conversationId, stateDir, { agentId: "main" });
    new TaskConversationRepository().activateExecutionSession({
      taskId: task.id,
      conversationId,
      agentId: 'main',
    });

    expect(buildTaskExecutionDirective(conversationId)).toContain(
      'Task: Keep the correct task context after opening chat full screen',
    );
  });

  it('does not treat a session context source as the task execution conversation', () => {
    const task = new TaskRepository().create({
      idempotencyKey: 'context-edge-session',
      title: 'Continue a linked discussion',
      objective: 'Continue the task in its linked discussion session',
    });
    const conversationId = "bf73ecf5-6a82-4aaa-89e6-2a317e776611";
    ensureSessionRecord(conversationId, stateDir, { agentId: "main" });
    new TaskContextRepository().add({
      taskId: task.id,
      targetKind: 'session',
      targetId: conversationId,
      role: 'reference',
      createdBy: { kind: 'user' },
    });

    expect(buildTaskExecutionDirective(conversationId)).toBe('');
  });
});
