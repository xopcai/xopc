import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SubagentRunOptions } from '../../agent/workflow/types.js';
import type { Config } from '../../config/schema.js';
import { buildWorkflowDefinition } from '../domain/definition-utils.js';
import { WorkflowEngine } from '../engine/workflow-engine.js';
import type { WorkflowRuntimeSubagentRunner } from '../runtime/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';

describe('WorkflowEngine graph runtime', () => {
  const originalStateDir = process.env.XOPC_STATE_DIR;
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-workflow-engine-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    await rm(stateDir, { recursive: true, force: true });
  });

  it('executes graph nodes and projects node ids into the run view', async () => {
    let capturedOptions: SubagentRunOptions | undefined;
    const runner: WorkflowRuntimeSubagentRunner = {
      async run(prompt, options) {
        capturedOptions = options;
        options.onProgress?.({ type: 'iteration', count: 1, max: 2 });
        return `## Report\n\n${'Detailed finding. '.repeat(40)}\n\nAnswer: ${prompt}`;
      },
    };
    const definition = buildWorkflowDefinition({
      name: 'demo',
      source: 'user',
      graph: {
        schemaVersion: 1,
        nodes: [
          { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
          { id: 'analysis', kind: 'agent', title: 'Analyze', phaseId: 'work', position: { x: 300, y: 0 }, config: { prompt: 'Goal={{goal}}; topic={{input.topic}}' } },
          { id: 'output', kind: 'output', title: 'Output', position: { x: 600, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'a', source: 'input', target: 'analysis' },
          { id: 'b', source: 'analysis', target: 'output' },
        ],
      },
    });
    const config = {} as Config;
    const eventStore = new WorkflowEventStore(config, 'main');
    const runStore = new WorkflowRunStore(config, 'main', eventStore);
    const engine = new WorkflowEngine({
      cwd: stateDir,
      projectId: 'project-1',
      eventStore,
      runStore,
      runner,
    });

    const view = await engine.startRun(definition, {
      runId: 'run-1',
      source: { kind: 'webui' },
      input: { topic: 'graphs' },
      goal: 'Explain visual workflows',
    });

    expect(view.run.status).toBe('succeeded');
    expect(view.run.result?.summary).toContain('Goal=Explain visual workflows; topic=graphs');
    expect(view.run.result?.summary.length).toBeGreaterThan(500);
    expect(view.run.result?.sections).toBeUndefined();
    expect(view.run.result?.data).toBeUndefined();
    expect(view.nodes.find((node) => node.id === 'output')?.resultPreview).toContain('## Report');
    expect(view.nodes.find((node) => node.id === 'output')?.resultPreview).not.toContain('{"summary"');
    expect(view.agents[0]).toMatchObject({ nodeId: 'analysis', label: 'Analyze', status: 'done' });
    expect(view.agents[0]?.steps).toHaveLength(1);
    expect(capturedOptions?.sessionMetadata?.projectId).toBe('project-1');
    expect(view.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'input', status: 'done' }),
      expect.objectContaining({ id: 'analysis', status: 'done' }),
      expect.objectContaining({ id: 'output', status: 'done' }),
    ]));
    expect((await eventStore.readRunEvents('run-1')).map((event) => event.type)).toContain('run_completed');
  });

  it('skips the inactive branch and still joins the selected branch', async () => {
    const runner: WorkflowRuntimeSubagentRunner = {
      async run(prompt) {
        return prompt;
      },
    };
    const definition = buildWorkflowDefinition({
      name: 'branching',
      source: 'user',
      graph: {
        schemaVersion: 1,
        nodes: [
          { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
          { id: 'choice', kind: 'decision', title: 'Choose', position: { x: 200, y: 0 }, config: { rule: { path: 'approved', operator: 'equals', value: true } } },
          { id: 'approved', kind: 'agent', title: 'Approved path', position: { x: 400, y: -100 }, config: { prompt: 'approved' } },
          { id: 'rejected', kind: 'agent', title: 'Rejected path', position: { x: 400, y: 100 }, config: { prompt: 'rejected' } },
          { id: 'join', kind: 'merge', title: 'Join', position: { x: 600, y: 0 }, config: { mode: 'array' } },
          { id: 'output', kind: 'output', title: 'Output', position: { x: 800, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'input-choice', source: 'input', target: 'choice' },
          { id: 'choice-approved', source: 'choice', sourcePort: 'true', target: 'approved' },
          { id: 'choice-rejected', source: 'choice', sourcePort: 'false', target: 'rejected' },
          { id: 'approved-join', source: 'approved', target: 'join' },
          { id: 'rejected-join', source: 'rejected', target: 'join' },
          { id: 'join-output', source: 'join', target: 'output' },
        ],
      },
    });
    const config = {} as Config;
    const eventStore = new WorkflowEventStore(config, 'main');
    const runStore = new WorkflowRunStore(config, 'main', eventStore);
    const engine = new WorkflowEngine({ cwd: stateDir, eventStore, runStore, runner });

    const view = await engine.startRun(definition, {
      runId: 'run-branch',
      source: { kind: 'webui' },
      input: { approved: false },
    });

    expect(view.run.status).toBe('succeeded');
    expect(view.nodes.find((node) => node.id === 'approved')?.status).toBe('skipped');
    expect(view.nodes.find((node) => node.id === 'rejected')?.status).toBe('done');
    expect(view.nodes.find((node) => node.id === 'join')?.status).toBe('done');
  });
});
