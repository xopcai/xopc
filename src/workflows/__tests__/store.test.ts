import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import type { WorkflowRun } from '../domain/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { resolveWorkflowRunEventsPath } from '../store/paths.js';
import { WorkflowRunStore } from '../store/run-store.js';

function createRun(runId: string, createdAtMs: number): WorkflowRun {
  return {
    id: runId,
    definitionId: 'research',
    definitionVersion: '1.0.0',
    title: 'Research task',
    goal: 'Understand workflow storage',
    input: {},
    status: 'queued',
    source: { kind: 'webui' },
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
  });

  afterEach(async () => {
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

    const view = await runStore.rebuildRunView('run-newer');
    const summaries = await runStore.listRunSummaries(10);

    expect(view?.run.status).toBe('succeeded');
    expect(summaries.map((summary) => summary.id)).toEqual(['run-newer', 'run-older']);
    expect(summaries[0]?.status).toBe('succeeded');
  });
});
