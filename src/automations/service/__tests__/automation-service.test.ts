import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { AutomationService } from '../automation-service.js';

async function waitFor<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2_000;
  let last = await read();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = await read();
  }
  return last;
}

describe('AutomationService', () => {
  let stateDir: string;
  let service: AutomationService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-automation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    service = new AutomationService();
    service.setDeps({
      getDefaultAgentId: () => 'main',
      agentService: {
        turnDispatcher: {
          processDirect: async (message) => `done: ${message}`,
        },
        getModelForSession: () => 'openai/gpt-4o-mini',
      },
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates and runs an agent automation', async () => {
    const automation = await service.create({
      name: 'Daily brief',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'summarize today' },
    });

    const queued = await service.runNow(automation.id);
    expect(queued.status).toBe('queued');

    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );
    const completed = runs.find((item) => item.id === queued.id);
    expect(completed).toMatchObject({
      status: 'succeeded',
      summary: 'done: summarize today',
      model: 'openai/gpt-4o-mini',
    });
    expect(completed?.sessionKey).toContain('automation');

    const updated = await service.get(automation.id);
    expect(updated?.state.lastRunStatus).toBe('succeeded');
    expect(updated?.state.runningRunId).toBeUndefined();

    const events = await service.listRunEvents(queued.id);
    expect(events.map((event) => event.type)).toEqual([
      'run.queued',
      'run.started',
      'action.started',
      'action.completed',
      'run.completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      automationId: automation.id,
      message: 'Automation run succeeded',
    });
  });

  it('passes workflow run limits to workflow automations', async () => {
    const workflowCalls: unknown[] = [];
    service.setDeps({
      workflowRunService: {
        startWorkflowRun: async (params) => {
          workflowCalls.push(params);
          return { ok: true, runId: 'workflow-run-1', sessionKey: 'agent:main:webchat:workflow-run-1' };
        },
      },
    });

    const automation = await service.create({
      name: 'Workflow review',
      trigger: { kind: 'manual' },
      action: {
        kind: 'workflow',
        workflowId: 'review',
        input: { target: 'current branch' },
        goal: 'Find merge blockers.',
        concurrency: 3,
        maxSubagents: 5,
      },
    });

    const queued = await service.runNow(automation.id);
    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );

    expect(runs.find((item) => item.id === queued.id)?.workflowRunId).toBe('workflow-run-1');
    expect(workflowCalls[0]).toMatchObject({
      definitionId: 'review',
      input: { target: 'current branch' },
      goal: 'Find merge blockers.',
      concurrency: 3,
      maxSubagents: 5,
    });
  });

  it('injects suggest-only guardrails into agent automations', async () => {
    const automation = await service.create({
      name: 'Safe helper',
      trigger: { kind: 'manual' },
      safety: { mode: 'suggest_only' },
      action: { kind: 'agent', instruction: 'Review the blocked goal.' },
    });

    const queued = await service.runNow(automation.id);
    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );

    const completed = runs.find((item) => item.id === queued.id);
    expect(completed?.summary).toContain('Automation safety mode: Suggest only.');
    expect(completed?.summary).toContain('Do not modify files, notes, goals, workflows, external systems, or persistent state.');
  });

  it('does not start workflows in suggest-only safety mode', async () => {
    const workflowCalls: unknown[] = [];
    service.setDeps({
      workflowRunService: {
        startWorkflowRun: async (params) => {
          workflowCalls.push(params);
          return { ok: true, runId: 'workflow-run-1', sessionKey: 'agent:main:webchat:workflow-run-1' };
        },
      },
    });

    const automation = await service.create({
      name: 'Safe workflow',
      trigger: { kind: 'manual' },
      safety: { mode: 'suggest_only' },
      action: {
        kind: 'workflow',
        workflowId: 'review',
      },
    });

    const queued = await service.runNow(automation.id);
    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );

    expect(workflowCalls).toHaveLength(0);
    expect(runs.find((item) => item.id === queued.id)?.summary).toContain('Suggest only: workflow review was not started.');
  });

  it('runs automations from matching product events', async () => {
    const automation = await service.create({
      name: 'Goal stalled helper',
      trigger: {
        kind: 'event',
        eventType: 'goal.status_changed',
        source: 'goals',
        payloadMatch: { status: 'blocked' },
      },
      action: { kind: 'agent', instruction: 'analyze the blocked goal' },
    });

    const ignored = await service.triggerEvent({
      type: 'goal.status_changed',
      source: 'goals',
      payload: { status: 'active' },
    });
    expect(ignored).toHaveLength(0);

    const started = await service.triggerEvent({
      type: 'goal.status_changed',
      source: 'goals',
      payload: { status: 'blocked', goalId: 'goal-1' },
    });
    expect(started).toHaveLength(1);

    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === started[0]!.id && item.status === 'succeeded'),
    );
    expect(runs.find((item) => item.id === started[0]!.id)?.summary).toBe('done: analyze the blocked goal');

    const events = await service.listRunEvents(started[0]!.id);
    expect(events[0]).toMatchObject({
      type: 'run.queued',
      message: 'Event goal.status_changed queued automation',
    });

    const productRuns = await service.listRunsForProductEvent({
      eventType: 'goal.status_changed',
      source: 'goals',
      payloadKey: 'goalId',
      payloadValue: 'goal-1',
    });
    expect(productRuns).toHaveLength(1);
    expect(productRuns[0]!.run.id).toBe(started[0]!.id);
    expect(productRuns[0]!.triggerEvent).toMatchObject({
      type: 'run.queued',
      message: 'Event goal.status_changed queued automation',
    });

    const rerun = await service.rerunFromRun(started[0]!.id);
    await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === rerun.id && item.status === 'succeeded'),
    );
    const productRunsAfterRerun = await service.listRunsForProductEvent({
      eventType: 'goal.status_changed',
      source: 'goals',
      payloadKey: 'goalId',
      payloadValue: 'goal-1',
    });
    expect(productRunsAfterRerun.map((item) => item.run.id)).toContain(rerun.id);
  });
});
