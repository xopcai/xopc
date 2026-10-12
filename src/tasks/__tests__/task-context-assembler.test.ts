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
import { resolveResponseLanguageForSession } from '../../agent/prompt/response-language.js';
import { applyUserProfilePatch } from '../../user-model/profile.js';
import { ConfigSchema } from '../../config/schema.js';
import { updateSessionConfig } from '../../storage/sqlite/index.js';
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
    new TaskContextRepository().add({
      taskId: task.id,
      targetKind: 'file',
      targetId: '/workspace/spec.md',
      role: 'input',
      title: 'Product specification',
      pinned: true,
      createdBy: { kind: 'user' },
    });

    const directive = buildTaskExecutionDirective(conversationId);
    expect(directive).toContain(
      'Task: Keep the correct task context after opening chat full screen',
    );
    expect(directive).toContain('Attached task context:');
    expect(directive).toContain('[input] file: /workspace/spec.md (Product specification)');
  });

  it.each(['zh', 'en'] as const)('uses the %s task locale for generated user-facing content', (locale) => {
    const task = new TaskRepository().create({ idempotencyKey: `language-${locale}`, title: 'English source material', objective: 'Review the attached English specification', locale });
    const conversationId = 'd3f214c2-1bba-4c27-a127-09d3955b724e';
    ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
    new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId, agentId: 'main' });
    expect(resolveResponseLanguageForSession(undefined, conversationId)).toBe(locale === 'zh' ? 'zh-CN' : 'en');
    expect(buildTaskExecutionDirective(conversationId)).toContain('wait reasons, questions, choices');
    expect(resolveResponseLanguageForSession(ConfigSchema.parse({ userContext: { preferences: { responseLanguage: 'en' } } }), conversationId)).toBe('en');
    updateSessionConfig(conversationId, { responseLanguage: 'zh-CN' });
    expect(resolveResponseLanguageForSession(undefined, conversationId)).toBe('zh-CN');
  });

  it('uses the saved user locale for legacy tasks without a locale and leaves regular chats on auto', () => {
    applyUserProfilePatch({ locale: 'zh-CN' });
    const task = new TaskRepository().create({ idempotencyKey: 'legacy-language', title: 'English source material', objective: 'Review the attached English specification' });
    const conversationId = 'd3f214c2-1bba-4c27-a127-09d3955b724e';
    ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
    expect(resolveResponseLanguageForSession(undefined, conversationId)).toBe('auto');
    new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId, agentId: 'main' });
    expect(resolveResponseLanguageForSession(undefined, conversationId)).toBe('zh-CN');
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
