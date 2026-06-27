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

  it('records subagent progress as agent step events', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run(prompt, opts) {
        opts.onProgress?.({ type: 'iteration', count: 1, max: 3 });
        opts.onProgress?.({
          type: 'tool_start',
          toolCallId: 'tool-1',
          toolName: 'file_grep',
          args: { query: 'workflow' },
        });
        opts.onProgress?.({
          type: 'tool_end',
          toolCallId: 'tool-1',
          toolName: 'file_grep',
          isError: false,
          resultPreview: 'workflow matches',
        });
        opts.onProgress?.({ type: 'thinking_delta', delta: 'checking' });
        opts.onProgress?.({ type: 'text_delta', delta: 'done' });
        return `${opts.label}: ${prompt}`;
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
await agent('scan repo', { label: 'Scanner' })
return 'ok'
`);

    const view = await engine.startRun(definition, {
      runId: 'run-progress',
      source: { kind: 'webui' },
    });
    const events = await eventStore.readRunEvents('run-progress');

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['agent_step_started', 'agent_step_completed']),
    );
    expect(view.agents[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Iteration 1/3', status: 'done' }),
        expect.objectContaining({
          label: 'Search files',
          toolName: 'file_grep',
          detail: 'workflow',
          status: 'done',
          resultPreview: 'workflow matches',
        }),
        expect.objectContaining({ label: 'Thinking', status: 'done' }),
        expect.objectContaining({ label: 'Writing response', status: 'done' }),
      ]),
    );
  });

  it('records a replayable agent invocation snapshot', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run(_prompt, opts) {
        expect(opts.allowedToolNames).toEqual(['file_read']);
        expect(opts.maxIterations).toBe(2);
        expect(opts.model).toMatchObject({ provider: 'openai', id: 'gpt-4o-mini' });
        return { ok: true };
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({
      cwd: stateDir,
      eventStore,
      runStore,
      runner,
      resolveModelId: (modelRef) => {
        expect(modelRef).toBe('small');
        return { provider: 'openai', id: 'gpt-4o-mini', name: 'GPT Mini' } as never;
      },
    });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
await agent('scan repo', {
  label: 'Scanner',
  model: 'small',
  toolset: ['file_read'],
  maxIterations: 2,
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
})
return 'ok'
`);

    const view = await engine.startRun(definition, {
      runId: 'run-invocation',
      source: { kind: 'webui' },
    });
    const queued = (await eventStore.readRunEvents('run-invocation')).find((event) => event.type === 'agent_queued');

    expect(view.agents[0]?.invocation).toMatchObject({
      prompt: 'scan repo',
      label: 'Scanner',
      modelRef: 'small',
      resolvedModelRef: 'openai/gpt-4o-mini',
      toolset: ['file_read'],
      maxIterations: 2,
      schema: { type: 'object', required: ['ok'] },
    });
    expect(queued?.payload).toMatchObject({
      invocation: { resolvedModelRef: 'openai/gpt-4o-mini' },
    });
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

  it('records output schema validation failures as result_validation_failed', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run() {
        return 'unused';
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });
    const definition: WorkflowDefinition = {
      ...createDefinition(`export const meta = { name: 'research', description: 'Research' }
return { ok: false }
`),
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    };

    const view = await engine.startRun(definition, {
      runId: 'run-output-invalid',
      source: { kind: 'webui' },
    });

    expect(view.run.status).toBe('failed');
    expect(view.run.error?.code).toBe('result_validation_failed');
    expect(view.run.error?.message).toContain('Workflow scripts must return a WorkflowResultEnvelope');
  });

  it('maps engine timeout to timeout status', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run() {
        return new Promise<string>(() => undefined);
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
await agent('scan', { label: 'Scanner' })
return 'ok'
`);
    const view = await engine.startRun(definition, {
      runId: 'run-timeout',
      source: { kind: 'webui' },
      timeoutSec: 0.001,
    });

    expect(view.run.status).toBe('timeout');
    expect(view.run.error?.code).toBe('timeout');
    expect(view.agents[0]?.status).toBe('skipped');
    expect(view.agents[0]?.currentStep).toBeUndefined();
  });

  it('runs a scoped replay as a new workflow run', async () => {
    const runner: WorkflowScriptSubagentRunner = {
      async run(prompt, opts) {
        expect(opts.allowedToolNames).toEqual(['file_grep']);
        expect(opts.maxIterations).toBe(4);
        expect(opts.schema).toMatchObject({ type: 'object' });
        expect(opts.model).toMatchObject({ provider: 'anthropic', id: 'claude-sonnet-4' });
        opts.onProgress?.({ type: 'text_delta', delta: 'done' });
        return `${opts.label}: ${prompt}`;
      },
    };
    const eventStore = new WorkflowEventStore(config, agentId);
    const runStore = new WorkflowRunStore(config, agentId, eventStore);
    const engine = new WorkflowEngine({
      cwd: stateDir,
      eventStore,
      runStore,
      runner,
      resolveModelId: (modelRef) => {
        expect(modelRef).toBe('anthropic/claude-sonnet-4');
        return { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude' } as never;
      },
    });
    const definition = createDefinition(`export const meta = { name: 'research', description: 'Research' }
return 'unused'
`);

    const view = await engine.startReplayRun(definition, {
      runId: 'run-replay',
      sourceRunId: 'run-source',
      replayScope: 'failed_phases',
      source: { kind: 'webui' },
      input: { query: 'workflow' },
      goal: 'Replay failed phase',
      targets: [
        {
          agentId: 'agent-1',
          label: 'Replay scanner',
          phaseId: 'discover',
          phaseTitle: 'Discover',
          prompt: 'scan again',
          invocation: {
            prompt: 'scan again',
            label: 'Replay scanner',
            phase: 'Discover',
            resolvedModelRef: 'anthropic/claude-sonnet-4',
            schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            toolset: ['file_grep'],
            maxIterations: 4,
          },
        },
        {
          agentId: 'agent-2',
          label: 'Replay reviewer',
          phaseId: 'discover',
          phaseTitle: 'Discover',
          prompt: 'review again',
          invocation: {
            prompt: 'review again',
            label: 'Replay reviewer',
            phase: 'Discover',
            resolvedModelRef: 'anthropic/claude-sonnet-4',
            schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            toolset: ['file_grep'],
            maxIterations: 4,
          },
        },
      ],
    });

    expect(view.run.status).toBe('succeeded');
    expect(view.run.id).toBe('run-replay');
    expect(view.run.result?.summary).toBe('Replay completed for 2/2 targets.');
    expect(view.run.result?.structuredOutput).toMatchObject({
      replay: { sourceRunId: 'run-source', scope: 'failed_phases' },
    });
    expect(view.phases[0]).toMatchObject({ id: 'discover', status: 'completed', agentIds: ['agent-1', 'agent-2'] });
    expect(view.agents.map((agent) => agent.resultPreview)).toEqual([
      'Replay scanner: scan again',
      'Replay reviewer: review again',
    ]);
  });
});
