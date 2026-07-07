import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { ProjectService } from '../../../projects/project-service.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { SessionConfigStore } from '../../../session/config-store.js';
import { SessionConfigService } from '../session-config-service.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:project-session-config';

const minimalConfig = {
  agents: {
    default: 'main',
    list: [
      {
        id: 'main',
        identity: { name: 'Main', role: 'General assistant' },
        responsibilities: { primary: ['Help the user complete tasks'] },
        workspace: { root: '~/default-ws' },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        memory: { mode: 'confirmWrite', sources: ['session'] },
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      },
    ],
  },
} as unknown as Config;

describe('SessionConfigService project workspace', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-session-config-project-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('rejects manual working directory changes for project sessions with a workspace root', async () => {
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const projects = new ProjectService();
    mkdirSync(join(stateDir, 'project-root'), { recursive: true });
    const project = projects.create({
      name: 'Workspace Locked Project',
      workspaceRoot: join(stateDir, 'project-root'),
    });
    projects.attachSession(SESSION_KEY, project.id);

    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const updateSpy = vi.spyOn(sessionConfigStore, 'update');
    const service = new SessionConfigService({
      sessionStore: {
        load: vi.fn(async () => []),
      } as never,
      sessionConfigStore,
      modelManager: {
        switchModelForSession: vi.fn(async () => true),
        clearSessionModelOverride: vi.fn(),
        applyModelForSession: vi.fn(),
      } as never,
      agentManager: {
        setModelForSession: vi.fn(),
        getAgent: vi.fn(() => null),
        setThinkingLevel: vi.fn(),
        setSessionWorkspaceOverride: vi.fn(),
        removeAgent: vi.fn(),
      } as never,
      getConfig: () => minimalConfig,
    });

    const result = await service.patch(SESSION_KEY, {
      workingDirectory: join(stateDir, 'other-root'),
    });

    expect(result).toEqual({
      ok: false,
      error: 'Project sessions use the project workspace and cannot change working directory',
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
