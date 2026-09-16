import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("f611af3a-b8a3-4874-8f1c-f25a1f50df7c", '', {"agentId":"coder","sourceChannel":"webchat","sourceChatId":"task-1","sessionType":"chat","routing":{"agentId":"coder","source":"webchat","accountId":"default","peerKind":"direct","peerId":"task-1"}});
  ensureFixtureConversation("5ffa4d86-8052-4d17-80ae-3b1ba46ec223", '', {"agentId":"coder","sourceChannel":"workflow","sourceChatId":"run-1","sessionType":"workflow-run","routing":{"agentId":"coder","source":"workflow","accountId":"default","peerKind":"direct","peerId":"run-1"}});
  ensureFixtureConversation("495cea4a-8cb2-49ec-8c72-6a599c899fef", '', {"agentId":"main","sourceChannel":"workflow","sourceChatId":"run-scope","sessionType":"workflow-run","routing":{"agentId":"main","source":"workflow","accountId":"default","peerKind":"direct","peerId":"run-scope"}});
}
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';

import type { ExecutionScope } from '../execution-scope.js';
import { formatCurrentWorkForPrompt, resolveExecutionScope } from '../execution-scope.js';

describe('formatCurrentWorkForPrompt', () => {
  it('keeps the current task contract visible on every turn', () => {
    seedConversationFixtures();
    const scope: ExecutionScope = {
      conversationId: "f611af3a-b8a3-4874-8f1c-f25a1f50df7c",
      projectId: 'project-1',
      objective: {
        kind: 'task',
        id: 'task-1',
        title: 'Ship project scope',
        objective: 'Keep every agent inside the project.',
        status: 'active',
        scopeBoundary: 'Do not modify unrelated UI.',
        acceptanceCriteria: ['Workflow children inherit the project.'],
        expectedOutputs: ['Targeted tests pass.'],
        nextAction: 'Implement the context resolver.',
      },
    };

    const prompt = formatCurrentWorkForPrompt(scope);
    expect(prompt).toContain('# Current Work');
    expect(prompt).toContain('Keep every agent inside the project.');
    expect(prompt).toContain('Do not modify unrelated UI.');
    expect(prompt).toContain('Workflow children inherit the project.');
    expect(prompt).toContain('Targeted tests pass.');
  });

  it('formats workflow objectives without inventing task criteria', () => {
    seedConversationFixtures();
    const prompt = formatCurrentWorkForPrompt({
      conversationId: "5ffa4d86-8052-4d17-80ae-3b1ba46ec223",
      projectId: 'project-1',
      objective: {
        kind: 'workflow',
        id: 'run-1',
        title: 'research',
        objective: 'Map the project architecture.',
        status: 'running',
      },
    });

    expect(prompt).toContain('Type: workflow');
    expect(prompt).toContain('Map the project architecture.');
    expect(prompt).not.toContain('## Acceptance Criteria');
  });
});

describe('resolveExecutionScope', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-scope-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('recognizes workflow-run metadata as the current objective', () => {
    seedConversationFixtures();
    const conversationId = "495cea4a-8cb2-49ec-8c72-6a599c899fef";
    ensureSessionRecord(conversationId, process.cwd(), { agentId: "main" });
    patchSessionMetadata(conversationId, {
      sessionType: 'workflow-run',
      workflowRunId: 'run-scope',
      workflowDefinitionId: 'project-research',
      projectId: 'project-1',
      customData: { workflowGoal: 'Map the project architecture.' },
    });

    expect(resolveExecutionScope(conversationId)).toMatchObject({
      projectId: 'project-1',
      objective: {
        kind: 'workflow',
        id: 'run-scope',
        title: 'project-research',
        objective: 'Map the project architecture.',
      },
    });
  });
});
