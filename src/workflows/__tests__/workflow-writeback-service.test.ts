import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { TaskContextRepository } from '../../tasks/task-context-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import type { WorkflowRun } from '../domain/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import { resolveWorkflowWritebackPolicy, WorkflowWritebackService } from '../service/workflow-writeback-service.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
let stateDir: string;

describe('workflow writeback', () => {
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-workflow-writeback-'));
    process.env.XOPC_STATE_DIR = stateDir;
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(async () => {
    closeXopcDatabase();
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('records the result on the bound project and finalizes only the linked task run', async () => {
    const project = new ProjectService().create({ name: 'Writeback' });
    const task = new TaskRepository().create({
      title: 'Review release',
      objective: 'Review the release',
      projectId: project.id,
      createdBy: { kind: 'user' },
    });
    const runs = new TaskRunRepository();
    const taskRun = runs.create({
      taskId: task.id,
      executorKind: 'workflow',
      executorRef: { workflowId: 'release-review' },
      trigger: { kind: 'user' },
      correlationId: 'writeback',
      idempotencyKey: 'writeback',
      contractVersion: task.latestContractVersion,
    });
    const taskSnapshot = new TaskContextRepository().captureSnapshot({
      ownerKind: 'task_run',
      ownerId: taskRun.id,
      query: task.title,
    });
    runs.start({
      runId: taskRun.id,
      expectedVersion: taskRun.version,
      contextSnapshotId: taskSnapshot.id,
      policySnapshot: {},
    });

    const config = {} as Config;
    const events = new WorkflowEventStore(config, 'main');
    const runStore = new WorkflowRunStore(config, 'main', events);
    const run: WorkflowRun = {
      id: 'workflow-run',
      definitionId: 'release-review',
      definitionVersion: '1',
      title: 'Release review',
      goal: 'Review',
      input: {},
      status: 'queued',
      source: { kind: 'webui', sessionKey: 'workflow-session' },
      metadata: {
        sessionKey: 'workflow-session',
        triggerSource: 'webui',
        agentId: 'main',
        projectId: project.id,
        taskRunId: taskRun.id,
        definition: {
          id: 'release-review', name: 'release-review', title: 'Release review', version: '1', revision: 1,
          graph: { schemaVersion: 1, nodes: [], edges: [] }, source: 'user', tags: [], phaseCount: 0,
          defaults: { concurrency: 1, timeoutSec: 60, maxSubagents: 1 },
        },
        writebackPolicy: resolveWorkflowWritebackPolicy(undefined, { projectId: project.id, taskId: task.id }),
      },
      metrics: { agentCount: 0, doneAgentCount: 0, errorAgentCount: 0, skippedAgentCount: 0, artifactCount: 0 },
      createdAtMs: 1,
    };
    await events.append({ runId: run.id, type: 'run_queued', payload: { run } });
    await events.append({ runId: run.id, type: 'run_completed', payload: { result: { summary: 'Review completed' } } });
    await runStore.rebuildRunView(run.id);

    await new WorkflowWritebackService().apply(runStore, run.id, 'succeeded');

    expect(new ProjectService().listUpdates(project.id, 1)[0]?.summary).toBe('Review completed');
    expect(runs.getReceipt(taskRun.id)).toMatchObject({
      status: 'succeeded',
      summary: 'Review completed',
      verification: { status: 'unverified' },
      completionVerdict: 'partial',
      needsUser: true,
    });
  });

  it('rejects writeback outside the bound project and linked task', () => {
    expect(() => resolveWorkflowWritebackPolicy({
      targets: [{ kind: 'project', id: 'project-b', mode: 'record' }],
    }, { projectId: 'project-a' })).toThrow('bound project');
    expect(() => resolveWorkflowWritebackPolicy({
      targets: [{ kind: 'task', id: 'task-b', mode: 'evaluate' }],
    }, { taskId: 'task-a' })).toThrow('linked task');
  });
});
