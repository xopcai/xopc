import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { ProjectService } from '../../projects/index.js';
import { SessionStore } from '../../session/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { prepareAutomationAgentSession } from '../automation-agent-session.js';

const minimalConfig = {
  agents: {
    default: 'main',
    list: [{
      id: 'main',
      identity: { name: 'Main', role: 'General assistant' },
      responsibilities: { primary: ['Help the user complete tasks'] },
      workspace: { root: '~/default-ws' },
      models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4o' } } },
      tools: { builtin: {} },
      skills: { mode: 'all' },
      workflows: {},
      boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
    }],
  },
} as unknown as Config;

describe('prepareAutomationAgentSession', () => {
  let stateDir: string;
  let store: SessionStore;
  let projects: ProjectService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-automation-session-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    store = new SessionStore({ config: minimalConfig });
    projects = new ProjectService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists project ownership and automation routing metadata', async () => {
    const project = projects.create({ name: 'Automation Project' });
    const sessionKey = 'agent:main:automation:default:dm:automation-1-run-1';

    await prepareAutomationAgentSession(store, projects, {
      sessionKey,
      projectId: project.id,
      agentId: 'main',
      peerId: 'automation-1-run-1',
      automationId: 'automation-1',
      runId: 'run-1',
    });

    await expect(store.getMetadata(sessionKey)).resolves.toMatchObject({
      projectId: project.id,
      sourceChannel: 'automation',
      sourceChatId: 'default:dm:automation-1-run-1',
      tags: ['automation'],
      routing: {
        agentId: 'main',
        source: 'automation',
        accountId: 'default',
        peerKind: 'dm',
        peerId: 'automation-1-run-1',
      },
      customData: {
        origin: 'automation',
        automationId: 'automation-1',
        latestAutomationRunId: 'run-1',
      },
    });
    expect(projects.listSessionKeys(project.id)).toContain(sessionKey);
  });

  it('keeps continuous sessions synchronized when the automation project changes', async () => {
    const first = projects.create({ name: 'First Project' });
    const second = projects.create({ name: 'Second Project' });
    const sessionKey = 'agent:main:automation:default:dm:automation-continuous';
    const base = {
      sessionKey,
      agentId: 'main',
      peerId: 'automation-continuous',
      automationId: 'automation-continuous',
    };

    await prepareAutomationAgentSession(store, projects, { ...base, projectId: first.id, runId: 'run-1' });
    await prepareAutomationAgentSession(store, projects, { ...base, projectId: second.id, runId: 'run-2' });
    await expect(store.getMetadata(sessionKey)).resolves.toMatchObject({
      projectId: second.id,
      customData: { latestAutomationRunId: 'run-2' },
    });
    expect(projects.listSessionKeys(first.id)).not.toContain(sessionKey);
    expect(projects.listSessionKeys(second.id)).toContain(sessionKey);

    await prepareAutomationAgentSession(store, projects, { ...base, runId: 'run-3' });
    await expect(store.getMetadata(sessionKey)).resolves.toMatchObject({
      customData: { latestAutomationRunId: 'run-3' },
    });
    expect((await store.getMetadata(sessionKey))?.projectId).toBeUndefined();
    expect(projects.listSessionKeys(second.id)).not.toContain(sessionKey);
  });
});
