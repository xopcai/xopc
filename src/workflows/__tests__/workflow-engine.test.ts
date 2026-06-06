import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import type { WorkflowDefinition } from '../domain/index.js';
import { WorkflowEngine } from '../engine/workflow-engine.js';
import type { WorkflowScriptSubagentRunner } from '../runtime/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';

function createDefinition(script: string): WorkflowDefinition {
  return {
    id: 'research',
    name: 'research',
    title: 'Research',
    description: 'Research a topic',
    version: '1.0.0',
    phases: [
      { id: 'discover', title: 'Discover' },
      { id: 'synthesize', title: 'Synthesize' },
    ],
    runtime: { kind: 'script', source: script },
    defaults: {
      concurrency: 2,
      timeoutSec: 60,
      maxSubagents: 8,
    },
    metadata: {
      tags: ['research'],
      builtIn: true,
      source: 'builtin',
      createdAtMs: 1_000,
      updatedAtMs: 1_000,
    },
  };
}

describe('WorkflowEngine', () => {
  const originalStateDir = process.env.XOPC_STATE_DIR;
  let stateDir: string;
  const config = {} as Config;
  const agentId = 'main';

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-workflow-engine-'));
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

  it('runs a script workflow and persists a projected run view', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run(prompt, opts) {
        return `${opts.label}: ${prompt}`;
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
phase('Discover')
const first = await agent('scan repo', { label: 'Scanner' })
phase('Synthesize')
const summary = await agent('summarize ' + first, { label: 'Synthesizer' })
log('done')
return { summary, sections: [{ kind: 'text', title: 'Summary', content: summary }] }
`);

    const view = await engine.startRun(definition, {
      runId: 'run-1',
      source: { kind: 'webui' },
      input: { query: 'workflow' },
      goal: 'Research workflow engine',
    });
    const persistedView = await runStore.readRunView('run-1');
    const events = await eventStore.readRunEvents('run-1');

    expect(view.run.status).toBe('succeeded');
    expect(view.run.goal).toBe('Research workflow engine');
    expect(view.run.result?.summary).toBe('Synthesizer: summarize Scanner: scan repo');
    expect(view.agents.map((agent) => agent.label)).toEqual(['Scanner', 'Synthesizer']);
    expect(view.phases.map((phase) => phase.id)).toEqual(['discover', 'synthesize']);
    expect(view.logs[0]?.message).toBe('done');
    expect(persistedView?.run.id).toBe('run-1');
    expect(events.map((event) => event.type)).toContain('run_completed');
  });

  it('records runtime failures as failed run events', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run() {
        throw new Error('subagent crashed');
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
await agent('fail', { label: 'Failing agent' })
throw new Error('script failed')
`);

    const view = await engine.startRun(definition, {
      runId: 'run-failed',
      source: { kind: 'api', requestId: 'request-1' },
    });

    expect(view.run.status).toBe('failed');
    expect(view.run.error?.code).toBe('runtime_error');
    expect(view.run.error?.message).toContain('script failed');
    expect(view.controls.canRetry).toBe(true);
  });
});
