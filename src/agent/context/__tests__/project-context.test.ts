import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectTaskContext } from '../project-context.js';
import { ProjectService } from '../../../projects/index.js';
import type { Project } from '../../../projects/types.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import {
  buildActiveProjectContextForPrompt,
  formatActiveProjectContextForPrompt,
} from '../project-context.js';

const project: Project = {
  id: 'project-1',
  name: 'xopc',
  slug: 'xopc',
  description: 'Personal assistant runtime',
  status: 'active',
  workspaceRoot: '/tmp/xopc',
  brief: 'Ship the Project feature.',
  instructions: 'Keep work scoped to Project context.',
  successCriteria: [],
  scope: {},
  nonGoals: [],
  health: 'on_track',
  version: 1,
  createdAt: 1,
  updatedAt: 2,
};

function task(patch: Partial<ProjectTaskContext> = {}): ProjectTaskContext {
  return {
    title: 'Finish project context',
    state: 'active/running',
    priority: 'high',
    ...patch,
  };
}

describe('formatActiveProjectContextForPrompt', () => {
  it('formats project metadata, active Tasks, and recent sessions', () => {
    const text = formatActiveProjectContextForPrompt({
      project,
      workspacePath: '/tmp/xopc',
      activeTasks: [task()],
      recentSessions: [
        {
          key: 'agent:main:webchat:default:direct:s1',
          name: 'Project planning',
          updatedAt: '2026-07-06T00:00:00.000Z',
          agentId: 'main',
        },
      ],
      memoryRecords: [
        {
          kind: 'session_summary',
          content: 'Decided to keep Project separate from Agent and Model.',
          updatedAt: '2026-07-06T01:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('# Active Project');
    expect(text).toContain('Project: xopc');
    expect(text).toContain('Workspace root: /tmp/xopc');
    expect(text).toContain('Ship the Project feature.');
    expect(text).toContain('Keep work scoped to Project context.');
    expect(text).toContain('- Finish project context | state=active/running | priority=high');
    expect(text).toContain('- Project planning | agent=main | updated=2026-07-06T00:00:00.000Z');
    expect(text).toContain('- session_summary | updated=2026-07-06T01:00:00.000Z | Decided to keep Project separate from Agent and Model.');
  });

  it('uses explicit empty markers when there are no active Tasks or sessions', () => {
    const text = formatActiveProjectContextForPrompt({
      project: { ...project, brief: undefined, instructions: undefined },
      activeTasks: [],
      recentSessions: [],
    });

    expect(text).toContain('## Active Tasks\n- None recorded.');
    expect(text).toContain('## Recent Project Sessions\n- None recorded.');
    expect(text).toContain('## Project Memory\n- None recorded.');
  });

  it('tells coder sessions which local-app release is stable', () => {
    const text = formatActiveProjectContextForPrompt({
      project,
      activeTasks: [],
      recentSessions: [],
      localApp: {
        extensionId: 'local-reading-list-abcd1234',
        draftVersion: 3,
        activeVersion: 2,
        installationState: 'installed',
        enabled: true,
        retainedVersions: [2, 1],
        latestAcceptance: {
          status: 'failed',
          sourceHash: '1234567890abcdef',
          failures: ['One interactive control needs an accessible name'],
          createdAt: 1234,
        },
      },
    });

    expect(text).toContain('## Local App Runtime');
    expect(text).toContain('Draft version: v3');
    expect(text).toContain('Installed version: v2');
    expect(text).toContain('Retained releases: v2, v1');
    expect(text).toContain('Latest acceptance: failed | source=1234567890ab | checked=1970-01-01T00:00:01.234Z');
    expect(text).toContain('Acceptance failure: One interactive control needs an accessible name');
    expect(text).toContain('Do not modify installed release artifacts directly');
  });
});

describe('buildActiveProjectContextForPrompt', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps objective-relevant project memory alongside recent memory', () => {
    const projects = new ProjectService();
    const scopedProject = projects.create({ name: 'Memory Scope Project' });
    const sessionKey = 'agent:main:webchat:default:direct:project-memory';
    ensureSessionRecord(sessionKey, process.cwd());
    projects.attachSession(sessionKey, scopedProject.id);
    upsertMemoryRecord({
      id: 'relevant-memory',
      providerId: 'test',
      kind: 'task_lesson',
      sourceAgentId: 'main',
      projectId: scopedProject.id,
      content: 'Needlearchitecture uses a single execution scope resolver.',
      nowMs: 1_000,
    });
    for (let index = 0; index < 6; index += 1) {
      upsertMemoryRecord({
        id: `recent-memory-${index}`,
        providerId: 'test',
        kind: 'session_summary',
        sourceAgentId: 'main',
        projectId: scopedProject.id,
        content: `Recent unrelated project note ${index}.`,
        nowMs: 2_000 + index,
      });
    }

    const text = buildActiveProjectContextForPrompt(sessionKey, {
      memoryQuery: 'Implement needlearchitecture safely',
    });

    expect(text).toContain('Needlearchitecture uses a single execution scope resolver.');
    expect(text).toContain('Recent unrelated project note 5.');
  });
});
