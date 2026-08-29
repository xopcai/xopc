import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../../projects/project-service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import type { WorkflowDefinition } from '../domain/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import {
  buildWorkflowRunDefinitionSnapshot,
  buildWorkflowRunInputEnvelope,
  buildWorkflowRunMetadata,
  resolveWorkflowReplayTargets,
  WorkflowRunService,
} from '../service/workflow-run-service.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
let stateDir: string;

function createDefinition(): WorkflowDefinition {
  return {
    id: 'release-check',
    name: 'release-check',
    title: 'Release Check',
    description: 'Check a release',
    version: '1.2.3',
    revision: 3,
    phases: [
      { id: 'inspect', title: 'Inspect' },
      { id: 'summarize', title: 'Summarize' },
    ],
    graph: {
      schemaVersion: 1,
      nodes: [
        { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
        { id: 'inspect', kind: 'agent', title: 'Inspect', phaseId: 'inspect', position: { x: 240, y: 0 }, config: { prompt: 'Inspect {{input}}' } },
        { id: 'summarize', kind: 'agent', title: 'Summarize', phaseId: 'summarize', position: { x: 480, y: 0 }, config: { prompt: 'Summarize {{predecessors}}' } },
        { id: 'output', kind: 'output', title: 'Result', position: { x: 720, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'input-inspect', source: 'input', target: 'inspect' },
        { id: 'inspect-summarize', source: 'inspect', target: 'summarize' },
        { id: 'summarize-output', source: 'summarize', target: 'output' },
      ],
    },
    defaults: {
      concurrency: 2,
      timeoutSec: 60,
      maxSubagents: 8,
    },
    metadata: {
      tags: ['release'],
      builtIn: true,
      source: 'builtin',
      estimatedAgents: { min: 1, max: 2 },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
    },
  };
}

describe('WorkflowRunService helpers', () => {
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-workflow-service-'));
    process.env.XOPC_STATE_DIR = stateDir;
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(async () => {
    closeXopcDatabase();
    if (originalStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = originalStateDir;
    }
    await rm(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('wraps raw input into a stable input envelope', () => {
    const envelope = buildWorkflowRunInputEnvelope({ branch: 'main' }, 'Check release');

    expect(envelope).toEqual({
      payload: { branch: 'main' },
      goal: 'Check release',
    });
  });

  it('preserves an existing input envelope', () => {
    const existingEnvelope = {
      payload: { branch: 'main' },
      variables: { releaseType: 'patch' },
      context: { actor: 'cron' },
    };

    expect(buildWorkflowRunInputEnvelope(existingEnvelope)).toBe(existingEnvelope);
  });

  it('builds a stable definition snapshot for run metadata', () => {
    const snapshot = buildWorkflowRunDefinitionSnapshot(createDefinition());

    expect(snapshot).toMatchObject({
      id: 'release-check',
      name: 'release-check',
      title: 'Release Check',
      version: '1.2.3',
      revision: 3,
      graph: expect.objectContaining({ schemaVersion: 1 }),
      source: 'builtin',
      tags: ['release'],
      phaseCount: 2,
      defaults: { concurrency: 2, timeoutSec: 60, maxSubagents: 8 },
      estimatedAgents: { min: 1, max: 2 },
    });
  });

  it('builds metadata with automation source and correlation fields', () => {
    const input = buildWorkflowRunInputEnvelope({ branch: 'main' }, 'Check release');
    const metadata = buildWorkflowRunMetadata({
      definition: createDefinition(),
      agentId: 'main',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-abc',
      source: { kind: 'automation', automationId: 'nightly', runId: 'run-1', scheduledAtMs: 123 },
      input,
      projectId: 'project-1',
      retryOfRunId: 'run-previous',
      idempotencyKey: 'idem-1',
    });

    expect(metadata).toMatchObject({
      sessionKey: 'agent:main:webchat:default:direct:wf_run-abc',
      triggerSource: 'automation',
      agentId: 'main',
      projectId: 'project-1',
      retryOfRunId: 'run-previous',
      input,
      correlation: { idempotencyKey: 'idem-1' },
      origin: { channel: 'automation', automationId: 'nightly', runId: 'run-1' },
      schedule: { automationId: 'nightly', runId: 'run-1', scheduledAtMs: 123 },
    });
  });

  it('rejects invalid input before preparing a run session', async () => {
    const definition: WorkflowDefinition = {
      ...createDefinition(),
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string' } },
        required: ['branch'],
      },
    };
    const prepareRunSession = vi.fn();
    const service = new WorkflowRunService({
      service: createGatewayHostStub(),
      sessionBridge: { prepareRunSession } as never,
      buildChildTools: () => [],
      definitionRegistry: {
        async list() {
          return [];
        },
        async get() {
          return definition;
        },
      },
    });

    const result = await service.startWorkflowRun({
      agentId: 'main',
      definitionId: definition.id,
      input: {},
      source: { kind: 'webui' },
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_input', httpStatus: 400 });
    expect(prepareRunSession).not.toHaveBeenCalled();
  });

  it('returns an existing run for a matching idempotency key', async () => {
    const definition = createDefinition();
    const config = {} as import('../../config/schema.js').Config;
    const eventStore = new WorkflowEventStore(config, 'main');
    const runStore = new WorkflowRunStore(config, 'main', eventStore);
    await eventStore.append({
      runId: 'existing-run',
      type: 'run_queued',
      payload: {
        run: {
          id: 'existing-run',
          definitionId: definition.id,
          definitionVersion: definition.version,
          title: definition.title,
          goal: 'Check release',
          input: {},
          status: 'queued',
          source: { kind: 'api', idempotencyKey: 'idem-1' },
          metadata: buildWorkflowRunMetadata({
            definition,
            agentId: 'main',
            projectId: 'project-index',
            sessionKey: 'agent:main:webchat:default:direct:wf_run-existing',
            source: { kind: 'api', idempotencyKey: 'idem-1' },
            input: buildWorkflowRunInputEnvelope({}, 'Check release'),
            idempotencyKey: 'idem-1',
          }),
          metrics: {
            agentCount: 0,
            doneAgentCount: 0,
            errorAgentCount: 0,
            skippedAgentCount: 0,
            artifactCount: 0,
          },
          createdAtMs: 1_000,
        },
      },
      createdAtMs: 1_000,
    });
    await runStore.rebuildRunView('existing-run');
    expect(
      getSqliteDatabase()
        .prepare(`SELECT project_id FROM workflow_runs WHERE run_id = ?`)
        .get('existing-run'),
    ).toEqual({ project_id: 'project-index' });

    const prepareRunSession = vi.fn();
    const service = new WorkflowRunService({
      service: createGatewayHostStub(config),
      sessionBridge: { prepareRunSession } as never,
      buildChildTools: () => [],
      definitionRegistry: {
        async list() {
          return [];
        },
        async get() {
          return definition;
        },
      },
    });

    const result = await service.startWorkflowRun({
      agentId: 'main',
      definitionId: definition.id,
      input: {},
      source: { kind: 'api', idempotencyKey: 'idem-1' },
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({
      ok: true,
      runId: 'existing-run',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-existing',
    });
    expect(prepareRunSession).not.toHaveBeenCalled();
  });

  it('passes the task project to the workflow session bridge', async () => {
    const definition = createDefinition();
    const project = new ProjectService().create({ name: 'Workflow Task Project' });
    const task = new TaskRepository().create({
      title: 'Run workflow in project', objective: 'Run workflow in project', projectId: project.id,
      expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [],
      acceptancePolicy: 'manual', outputDestinations: [], createdBy: { kind: 'user' },
    });
    const taskRun = new TaskRunRepository().create({
      taskId: task.id, executorKind: 'workflow', executorRef: { workflowId: definition.id },
      trigger: { kind: 'user' }, correlationId: 'workflow-project', idempotencyKey: 'workflow-project',
      contractVersion: task.latestContractVersion,
    });
    const prepareRunSession = vi.fn(async () => {
      const sessionKey = 'agent:main:workflow:default:run:project-workflow';
      const now = Date.now();
      getSqliteDatabase().prepare(
        `INSERT INTO sessions (
          session_key, agent_id, session_id, created_at, updated_at, last_accessed_at,
          source_channel, source_chat_id, project_id
        ) VALUES (?, 'main', ?, ?, ?, ?, 'workflow', ?, ?)`,
      ).run(sessionKey, 'project-workflow', now, now, now, 'project-workflow', project.id);
      return { sessionKey };
    });
    const service = new WorkflowRunService({
      service: createGatewayHostStub(),
      sessionBridge: { prepareRunSession } as never,
      buildChildTools: () => [],
      definitionRegistry: {
        async list() {
          return [];
        },
        async get() {
          return definition;
        },
      },
    });

    const result = await service.startWorkflowRun({
      agentId: 'main',
      definitionId: definition.id,
      taskRunId: taskRun.id,
      input: {},
      source: { kind: 'webui' },
    });

    expect(result.ok).toBe(true);
    expect(prepareRunSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      goal: '',
    }));
  });

  it('inherits project id from the parent session when starting a workflow run', async () => {
    const definition = createDefinition();
    const project = new ProjectService().create({ name: 'Parent Session Project' });
    const parentSessionKey = 'agent:main:tui:parent-session-project';
    const getMetadata = vi.fn(async (key: string) => (key === parentSessionKey ? { projectId: project.id } : null));
    const prepareRunSession = vi.fn(async () => ({
      sessionKey: 'agent:main:workflow:default:run:parent-session-project',
    }));
    const service = new WorkflowRunService({
      service: {
        ...createGatewayHostStub(),
        sessionIndexInstance: { getStore: () => ({ getMetadata }) },
      } as never,
      sessionBridge: { prepareRunSession } as never,
      buildChildTools: () => [],
      definitionRegistry: {
        async list() {
          return [];
        },
        async get() {
          return definition;
        },
      },
    });

    const result = await service.startWorkflowRun({
      agentId: 'main',
      definitionId: definition.id,
      input: {},
      parentSessionKey,
      source: { kind: 'chat', sessionKey: parentSessionKey },
    });

    expect(result.ok).toBe(true);
    expect(prepareRunSession).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey,
      projectId: project.id,
    }));
  });

  it('preserves project metadata when retrying a workflow run', async () => {
    const definition = createDefinition();
    const project = new ProjectService().create({ name: 'Retry Project' });
    const config = {} as import('../../config/schema.js').Config;
    const eventStore = new WorkflowEventStore(config, 'main');
    const runStore = new WorkflowRunStore(config, 'main', eventStore);
    await eventStore.append({
      runId: 'project-run',
      type: 'run_queued',
      payload: {
        run: {
          id: 'project-run',
          definitionId: definition.id,
          definitionVersion: definition.version,
          title: definition.title,
          goal: 'Check project release',
          input: { branch: 'main' },
          status: 'failed',
          source: { kind: 'webui', sessionKey: 'agent:main:webchat:default:direct:project-run' },
          metadata: buildWorkflowRunMetadata({
            definition,
            agentId: 'main',
            projectId: project.id,
            sessionKey: 'agent:main:webchat:default:direct:project-run',
            source: { kind: 'webui', sessionKey: 'agent:main:webchat:default:direct:project-run' },
            input: {
              payload: { branch: 'main' },
              goal: 'Check project release',
              variables: { project: 'retry' },
            },
          }),
          metrics: {
            agentCount: 0,
            doneAgentCount: 0,
            errorAgentCount: 1,
            skippedAgentCount: 0,
            artifactCount: 0,
          },
          createdAtMs: 1_000,
        },
      },
      createdAtMs: 1_000,
    });
    await runStore.rebuildRunView('project-run');

    const prepareRunSession = vi.fn(async () => ({
      sessionKey: 'agent:main:workflow:default:run:project-retry-2',
    }));
    const service = new WorkflowRunService({
      service: createGatewayHostStub(config),
      sessionBridge: { prepareRunSession } as never,
      buildChildTools: () => [],
      definitionRegistry: {
        async list() {
          return [];
        },
        async get() {
          return definition;
        },
      },
    });

    const result = await service.retryWorkflowRun({
      agentId: 'main',
      runId: 'project-run',
    });

    expect(result.ok).toBe(true);
    expect(prepareRunSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
    }));
  });

  it('resolves failed-agent replay targets from a run view', () => {
    const view = createReplayView();

    const replay = resolveWorkflowReplayTargets(view, 'failed_agents');

    expect(replay.targets).toEqual([
      expect.objectContaining({
        agentId: 'agent-2',
        label: 'Failing review',
        phaseId: 'inspect',
        phaseTitle: 'Inspect',
        prompt: 'Review risky files',
        invocation: expect.objectContaining({
          resolvedModelRef: 'openai/gpt-4o-mini',
          toolset: ['file_read'],
          maxIterations: 3,
        }),
      }),
    ]);
  });

  it('resolves failed-phase replay targets with successful peers included', () => {
    const view = createReplayView();

    const replay = resolveWorkflowReplayTargets(view, 'failed_phases');

    expect(replay.phaseIds).toEqual(['inspect']);
    expect(replay.targets.map((target) => target.agentId)).toEqual(['agent-1', 'agent-2']);
  });
});

function createGatewayHostStub(config = {} as import('../../config/schema.js').Config) {
  return {
    currentConfig: config,
    currentWorkspacePath: stateDir,
    messageBusInstance: {},
    agentService: { getModelForSession: () => 'openai/gpt-4o-mini' },
    sessionIndexInstance: { getStore: () => ({}) },
    emit: vi.fn(),
  } as never;
}

function createReplayView(): import('../domain/index.js').WorkflowRunView {
  const definition = createDefinition();
  return {
    run: {
      id: 'run-source',
      definitionId: definition.id,
      definitionVersion: definition.version,
      title: definition.title,
      goal: 'Check release',
      input: {},
      status: 'failed',
      source: { kind: 'webui', sessionKey: 'agent:main:webchat:default:direct:wf_run-source' },
      metadata: buildWorkflowRunMetadata({
        definition,
        agentId: 'main',
        sessionKey: 'agent:main:webchat:default:direct:wf_run-source',
        source: { kind: 'webui', sessionKey: 'agent:main:webchat:default:direct:wf_run-source' },
        input: buildWorkflowRunInputEnvelope({}, 'Check release'),
      }),
      metrics: {
        agentCount: 2,
        doneAgentCount: 1,
        errorAgentCount: 1,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs: 1_000,
    },
    phases: [
      {
        id: 'inspect',
        title: 'Inspect',
        status: 'failed',
        agentIds: ['agent-1', 'agent-2'],
      },
    ],
    agents: [
      {
        id: 'agent-1',
        label: 'Successful review',
        phaseId: 'inspect',
        status: 'done',
        prompt: 'Review stable files',
        sessionKey: 'agent:main:workflow:run-source:subagent:agent-1',
        transcriptMessageCount: 2,
        resultPreview: 'ok',
        steps: [],
      },
      {
        id: 'agent-2',
        label: 'Failing review',
        phaseId: 'inspect',
        status: 'error',
        prompt: 'Review risky files',
        invocation: {
          prompt: 'Review risky files',
          label: 'Failing review',
          phase: 'Inspect',
          resolvedModelRef: 'openai/gpt-4o-mini',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          toolset: ['file_read'],
          maxIterations: 3,
        },
        sessionKey: 'agent:main:workflow:run-source:subagent:agent-2',
        transcriptMessageCount: 2,
        error: 'failed',
        steps: [],
      },
    ],
    nodes: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: true, canArchive: true },
  };
}
