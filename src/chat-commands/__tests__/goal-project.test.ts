import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalService } from '../../goals/index.js';
import { ProjectService } from '../../projects/project-service.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import type { Config } from '../../config/schema.js';
import { commandRegistry } from '../registry.js';
import { registerGoalCommand } from '../builtins/goal.js';
import type { CommandContext } from '../types.js';

const SESSION_KEY = 'agent:main:tui:goal-command-project';

function createContext(config: Config): CommandContext {
  return {
    sessionKey: SESSION_KEY,
    source: 'cli',
    channelId: 'tui',
    chatId: 'goal-command-project',
    senderId: 'local-user',
    isGroup: false,
    config,
    setTyping: vi.fn(async () => undefined),
    supports: () => false,
  } as unknown as CommandContext;
}

describe('/goal project binding', () => {
  let stateDir: string;

  beforeEach(() => {
    commandRegistry.clear();
    registerGoalCommand();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-command-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    commandRegistry.clear();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('inherits projectId from the current session when creating a goal', async () => {
    ensureSessionRecord(SESSION_KEY, stateDir);
    const projects = new ProjectService();
    const project = projects.create({ name: 'Goal Command Project' });
    projects.attachSession(SESSION_KEY, project.id);

    const result = await commandRegistry.execute('goal', createContext({ agents: { default: 'main', list: [] } } as Config), 'Ship slash goal');

    expect(result.success).toBe(true);
    const goals = new GoalService().list({ projectId: project.id });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.title).toBe('Ship slash goal');
    expect(goals[0]?.projectId).toBe(project.id);
  });
});
