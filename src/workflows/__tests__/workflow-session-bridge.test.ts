import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
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

const minimalConfig = ConfigSchema.parse({
  agents: {
    default: 'main',
    list: [
      {
        id: 'main',
        profile: { name: 'Main' },
        workspace: '~/default-ws',
      },
    ],
  },
});

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

    await expect(store.getMetadata(result.conversationId)).resolves.toMatchObject({
      projectId: project.id,
      sessionType: 'workflow-run',
      hiddenFromSessionList: true,
      messageCount: 1,
      customData: { deferVisibilityUntilOutput: true },
    });
  });

  it('reveals workflow sessions when a terminal result is persisted', async () => {
    const result = await bridge.prepareRunSession({
      runId: 'run-terminal-output',
      agentId: 'main',
      definitionId: 'wf',
      definitionTitle: 'Workflow',
      goal: 'Do workflow work',
    });

    await bridge.handleRunViewUpdated({
      run: {
        id: 'run-terminal-output',
        definitionId: 'wf',
        definitionVersion: '1.0.0',
        title: 'Workflow',
        goal: 'Do workflow work',
        input: {},
        status: 'failed',
        source: { kind: 'automation', automationId: 'automation-1' },
        metadata: {
          conversationId: result.conversationId,
          triggerSource: 'automation',
          agentId: 'main',
          definition: {} as never,
        },
        error: { code: 'runtime_error', message: 'failed', recoverable: false },
        metrics: { agentCount: 0, doneAgentCount: 0, errorAgentCount: 0, skippedAgentCount: 0, artifactCount: 0 },
        createdAtMs: 1,
      },
      phases: [],
      agents: [],
      nodes: [],
      logs: [],
      artifacts: [],
      timeline: [],
      controls: { canCancel: false, canRetry: true, canArchive: true },
    });

    await expect(store.getMetadata(result.conversationId)).resolves.toMatchObject({
      hiddenFromSessionList: false,
      messageCount: 3,
      customData: {
        workflowRunId: 'run-terminal-output',
        deferVisibilityUntilOutput: true,
      },
    });
  });

  it('inherits projectId from parent sessions', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Parent Project' });
    const parentConversationId = "1f945181-2799-4582-8fb0-490ce87010fa";
    ensureSessionRecord(parentConversationId, process.cwd(), { agentId: "main" });
    projects.attachSession(parentConversationId, project.id);

    const result = await bridge.prepareRunSession({
      runId: 'run-parent-project',
      agentId: 'main',
      definitionId: 'wf',
      definitionTitle: 'Workflow',
      goal: 'Do workflow work',
      parentConversationId,
    });

    await expect(store.getMetadata(result.conversationId)).resolves.toMatchObject({
      projectId: project.id,
      sessionType: 'workflow-run',
    });
  });
});
