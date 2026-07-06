import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import type { WorkflowRun } from '../domain/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { resolveWorkflowRunEventsPath } from '../store/paths.js';
import { WorkflowRunStore } from '../store/run-store.js';

function createRun(runId: string, createdAtMs: number, projectId?: string): WorkflowRun {
  return {
    id: runId,
    definitionId: 'research',
    definitionVersion: '1.0.0',
    title: 'Research task',
    goal: 'Understand workflow storage',
    input: {},
    status: 'queued',
    source: { kind: 'webui' },
    metadata: {
      sessionKey: `agent:main:webchat:default:direct:wf_${runId}`,
      triggerSource: 'webui',
      agentId: 'main',
      ...(projectId ? { projectId } : {}),
      definition: {
        id: 'research',
        name: 'research',
        title: 'Research task',
        version: '1.0.0',
        source: 'builtin',
        tags: [],
        phaseCount: 0,
      },
    },
    metrics: {
      agentCount: 0,
      doneAgentCount: 0,
      errorAgentCount: 0,
      skippedAgentCount: 0,
      artifactCount: 0,
    },
    createdAtMs,
  };
}

describe('WorkflowEventStore and WorkflowRunStore', () => {
  const originalStateDir = process.env.XOPC_STATE_DIR;
  let stateDir: string;
  const config = {} as Config;
  const agentId = 'main';

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-workflows-'));
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
    await rm(stateDir, { recursive: true, force: true });
  });

  it('appends events as JSONL and reads them in sequence order', async () => {
    const eventStore = new WorkflowEventStore(config, agentId);

    await eventStore.append({
      runId: 'run-1',
      type: 'run_queued',
      payload: { run: createRun('run-1', 1_000) },
      createdAtMs: 1_000,
    });
    await eventStore.append({
      runId: 'run-1',
      type: 'run_started',
      payload: { startedAtMs: 1_001 },
      createdAtMs: 1_001,
    });

    const events = await eventStore.readRunEvents('run-1');
    const eventsPath = resolveWorkflowRunEventsPath(config, agentId, 'run-1');
    const fileContent = await readFile(eventsPath, 'utf8');

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(fileContent.trim().split('\n')).toHaveLength(2);
  });

  it('rebuilds and lists projected run views', async () => {
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);

    await eventStore.append({
      runId: 'run-older',
      type: 'run_queued',
      payload: { run: createRun('run-older', 1_000) },
      createdAtMs: 1_000,
    });
    await eventStore.append({
      runId: 'run-newer',
      type: 'run_queued',
      payload: { run: createRun('run-newer', 2_000) },
      createdAtMs: 2_000,
    });
    await eventStore.append({
      runId: 'run-newer',
      type: 'run_completed',
      payload: { result: { summary: 'Done', sections: [] } },
      createdAtMs: 2_010,
    });

    await runStore.rebuildRunView('run-older');
    const view = await runStore.rebuildRunView('run-newer');
    const summaries = await runStore.listRunSummaries(10);

    expect(view?.run.status).toBe('succeeded');
    expect(summaries.map((summary) => summary.id)).toEqual(['run-newer', 'run-older']);
    expect(summaries[0]?.status).toBe('succeeded');
  });

  it('filters projected run summaries by project', async () => {
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);

    await eventStore.append({
      runId: 'run-project-a',
      type: 'run_queued',
      payload: { run: createRun('run-project-a', 1_000, 'project-a') },
      createdAtMs: 1_000,
    });
    await eventStore.append({
      runId: 'run-project-b',
      type: 'run_queued',
      payload: { run: createRun('run-project-b', 2_000, 'project-b') },
      createdAtMs: 2_000,
    });

    await runStore.rebuildRunView('run-project-a');
    await runStore.rebuildRunView('run-project-b');

    const summaries = await runStore.listRunSummaries(10, { projectId: 'project-a' });

    expect(summaries.map((summary) => summary.id)).toEqual(['run-project-a']);
    expect(summaries[0]?.metadata?.projectId).toBe('project-a');
  });
});
