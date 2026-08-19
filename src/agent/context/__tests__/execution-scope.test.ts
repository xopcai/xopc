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
    const scope: ExecutionScope = {
      sessionKey: 'agent:coder:webchat:default:direct:task-1',
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
    const prompt = formatCurrentWorkForPrompt({
      sessionKey: 'agent:coder:workflow:run-1',
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
    const sessionKey = 'agent:main:workflow:run-scope';
    ensureSessionRecord(sessionKey, process.cwd());
    patchSessionMetadata(sessionKey, {
      sessionType: 'workflow-run',
      workflowRunId: 'run-scope',
      workflowDefinitionId: 'project-research',
      projectId: 'project-1',
      customData: { workflowGoal: 'Map the project architecture.' },
    });

    expect(resolveExecutionScope(sessionKey)).toMatchObject({
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
