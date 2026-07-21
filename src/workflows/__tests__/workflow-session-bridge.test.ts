import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import { SessionStore } from '../../session/store.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import type { GatewayWorkflowHost } from '../../gateway/gateway-workflow-host.types.js';
import { WorkflowSessionBridge } from '../service/workflow-session-bridge.js';

const minimalConfig = {
  agents: {
    default: 'main',
    list: [
      {
        id: 'main',
        identity: { name: 'Main', role: 'General assistant' },
        responsibilities: { primary: ['Help the user complete tasks'] },
        workspace: { root: '~/default-ws' },
        models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4o' } } },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      },
    ],
  },
} as unknown as Config;

describe('WorkflowSessionBridge project association', () => {
  let stateDir: string;
  let store: SessionStore;
  let bridge: WorkflowSessionBridge;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-workflow-project-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    store = new SessionStore({ config: minimalConfig });
    bridge = new WorkflowSessionBridge({
      currentConfig: minimalConfig,
      currentWorkspacePath: process.cwd(),
      messageBusInstance: {} as never,
      agentService: { getModelForSession: vi.fn(() => 'openai/gpt-4o') },
      emit: vi.fn(),
      sessionIndexInstance: {
        getStore: () => store,
      },
    } as unknown as GatewayWorkflowHost);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('writes explicit projectId onto workflow sessions', async () => {
    const project = new ProjectService().create({ name: 'Workflow Project' });

    const result = await bridge.prepareRunSession({
      runId: 'run-explicit-project',
      agentId: 'main',
      definitionId: 'wf',
      definitionTitle: 'Workflow',
      goal: 'Do workflow work',
      projectId: project.id,
    });

    await expect(store.getMetadata(result.sessionKey)).resolves.toMatchObject({
      projectId: project.id,
      sessionType: 'workflow-run',
    });
  });

  it('inherits projectId from parent sessions', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Parent Project' });
    const parentSessionKey = 'agent:main:webchat:default:direct:parent-project-session';
    ensureSessionRecord(parentSessionKey, process.cwd());
    projects.attachSession(parentSessionKey, project.id);

    const result = await bridge.prepareRunSession({
      runId: 'run-parent-project',
      agentId: 'main',
      definitionId: 'wf',
      definitionTitle: 'Workflow',
      goal: 'Do workflow work',
      parentSessionKey,
    });

    await expect(store.getMetadata(result.sessionKey)).resolves.toMatchObject({
      projectId: project.id,
      sessionType: 'workflow-run',
    });
  });
});
