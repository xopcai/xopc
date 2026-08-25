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
    const sessionKey = 'agent:main:webchat:default:direct:legacy-task-chat';
    ensureSessionRecord(sessionKey, stateDir);
    new TaskConversationRepository().activateExecutionSession({
      taskId: task.id,
      sessionKey,
      agentId: 'main',
    });

    expect(buildTaskExecutionDirective(sessionKey)).toContain(
      'Task: Keep the correct task context after opening chat full screen',
    );
  });

  it('does not treat a session context source as the task execution conversation', () => {
    const task = new TaskRepository().create({
      idempotencyKey: 'context-edge-session',
      title: 'Continue a linked discussion',
      objective: 'Continue the task in its linked discussion session',
    });
    const sessionKey = 'agent:main:webchat:default:direct:linked-discussion';
    ensureSessionRecord(sessionKey, stateDir);
    new TaskContextRepository().add({
      taskId: task.id,
      targetKind: 'session',
      targetId: sessionKey,
      role: 'reference',
      createdBy: { kind: 'user' },
    });

    expect(buildTaskExecutionDirective(sessionKey)).toBe('');
  });
});
