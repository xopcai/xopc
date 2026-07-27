import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalService } from '../../../goals/index.js';
import { ProjectService } from '../../../projects/project-service.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { createGoalTool } from '../goal-tool.js';

const SESSION_KEY = 'agent:main:tui:goal-project-inherit';

describe('goal tool project binding', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-tool-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('inherits projectId from the current session when creating a goal', async () => {
    ensureSessionRecord(SESSION_KEY, stateDir);
    const project = new ProjectService().create({ name: 'Goal Tool Project' });
    new ProjectService().attachSession(SESSION_KEY, project.id);
    const tool = createGoalTool({ getCurrentSessionKey: () => SESSION_KEY });

    const result = await tool.execute('tool-call-1', {
      action: 'create',
      title: 'Ship TUI project goals',
    });

    const goals = new GoalService().list({ projectId: project.id });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.title).toBe('Ship TUI project goals');
    expect(goals[0]?.projectId).toBe(project.id);
    expect(result.details.delivery).toMatchObject({
      operation: 'created',
      primary: {
        kind: 'goal',
        id: goals[0]?.id,
        projectId: project.id,
      },
    });
  });
});
