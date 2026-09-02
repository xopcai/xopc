import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { ExecutionEnvironmentStore } from '../../../execution-environments/store.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { SessionHydrator } from '../session-hydrator.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:missing-environment';

const config = {
  agents: {
    default: 'main',
    defaultPreset: 'default',
    capabilityPresets: {
      default: {
        id: 'default',
        name: 'Global defaults',
        models: { defaultRole: 'deep', roles: { deep: { model: 'test/model' } } },
      },
    },
    list: [{
      id: 'main',
      identity: { name: 'Main', role: 'Assistant' },
      responsibilities: { primary: ['Help'] },
      workspace: { root: '/tmp/xopc-default-workspace' },
      tools: { builtin: {} },
      skills: { mode: 'all' },
      workflows: {},
      boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
    }],
  },
} as unknown as Config;

describe('SessionHydrator execution environment safety', () => {
  let stateDir: string | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(`${tmpdir()}/xopc-session-hydrator-`);
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: `${stateDir}/xopc.db` });
  });

  afterEach(async () => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  });

  it('fails closed instead of recreating a missing managed worktree root', async () => {
    const rootPath = `${stateDir}/missing-worktree`;
    const store = new ExecutionEnvironmentStore();
    const requested = store.create({
      id: 'missing-environment',
      hostId: 'local',
      kind: 'managed_worktree',
      rootPath,
      repositoryRoot: `${stateDir}/repository`,
      gitCommonDir: `${stateDir}/repository/.git`,
    });
    const provisioning = store.transition({
      environmentId: requested.id,
      expectedVersion: requested.version,
      toStatus: 'provisioning',
      reason: 'test provisioning',
    });
    const ready = store.transition({
      environmentId: requested.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'test ready',
    });
    store.bind({ subjectKind: 'session', subjectId: SESSION_KEY, environmentId: ready.id });

    const setSessionWorkspaceOverride = vi.fn();
    const hydrator = new SessionHydrator({
      sessionConfigStore: { get: vi.fn(async () => null) } as never,
      agentManager: { setSessionWorkspaceOverride } as never,
      modelManager: {} as never,
      getConfig: () => config,
    });

    await expect(hydrator.workspace(SESSION_KEY)).rejects.toThrow(/root is unavailable/);
    expect(setSessionWorkspaceOverride).not.toHaveBeenCalled();
    expect(existsSync(rootPath)).toBe(false);
  });
});
