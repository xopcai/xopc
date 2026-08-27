import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { AutomationService } from '../automation-service.js';
import { saveAutomationRun } from '../../storage/automation-run-repository.js';

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
      'run.deadline_resolved',
      'action.completed',
      'run.completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      automationId: automation.id,
      message: 'Automation run succeeded',
    });
  });

  it('reports completed runs through the completion hook', async () => {
    const onRunCompleted = vi.fn();
    service.setDeps({ onRunCompleted });
    const automation = await service.create({
      name: 'Notify on completion',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'finish this task' },
    });

    const queued = await service.runNow(automation.id);
    await waitFor(
      () => onRunCompleted.mock.calls,
      (calls) => calls.some(([run]) => run.id === queued.id),
    );

    expect(onRunCompleted).toHaveBeenCalledWith(expect.objectContaining({
      id: queued.id,
      automationId: automation.id,
      status: 'succeeded',
    }));
  });

  it('executes a typed task command with a stable automation idempotency key', async () => {
    const executeTaskCommand = vi.fn(() => ({ ok: true as const, runId: 'task-run-1' }));
    service.setDeps({ executeTaskCommand });
    const automation = await service.create({
      name: 'Start durable task',
      trigger: { kind: 'manual' },
      action: {
        kind: 'task_command',
        taskId: 'task-1',
        command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } },
      },
    });

    const queued = await service.runNow(automation.id);
    const completed = await waitFor(
      () => service.getRun(queued.id),
      (run) => run?.status === 'succeeded',
    );

    expect(completed?.summary).toBe('TaskRun task-run-1 queued');
    expect(executeTaskCommand).toHaveBeenCalledWith({
      taskId: 'task-1',
      idempotencyKey: `automation:${automation.id}:${queued.id}`,
      command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
  });

  it('aborts the agent turn at the automation deadline and persists the session link', async () => {
    let receivedSignal: AbortSignal | undefined;
    service.setDeps({
      agentService: {
        turnDispatcher: {
          processDirect: async (_message, _sessionKey, _origin, _attachments, _thinking, options) => {
            receivedSignal = options?.signal;
            await new Promise<void>((resolve) => {
              if (options?.signal?.aborted) resolve();
              else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            return '';
          },
        },
      },
    });
    const automation = await service.create({
      name: 'Bounded agent run',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'wait', timeoutSeconds: 1 },
    });

    const queued = await service.runNow(automation.id);
    const linked = await waitFor(
      () => service.getRun(queued.id),
      (run) => Boolean(run?.sessionKey && run.deadlineAtMs),
    );
    expect(linked?.status).toBe('running');

    const completed = await waitFor(
      () => service.getRun(queued.id),
      (run) => run?.status === 'timeout',
    );
    expect(receivedSignal?.aborted).toBe(true);
    expect(completed).toMatchObject({
      status: 'timeout',
      currentPhase: 'completed',
      termination: {
        reason: 'deadline_exceeded',
        component: 'automation',
        cancellationConfirmed: true,
      },
    });
    expect(completed?.cancelConfirmedAtMs).toBeTypeOf('number');
  });

  it('applies the automation deadline to the completion webhook', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const automation = await service.create({
        name: 'Bounded webhook',
        trigger: { kind: 'manual' },
        action: { kind: 'agent', instruction: 'finish quickly' },
        completionWebhookUrl: 'https://example.com/hook',
        reliability: { executionTimeoutSeconds: 1 },
      });

      const queued = await service.runNow(automation.id);
      const completed = await waitFor(
        () => service.getRun(queued.id),
        (run) => run?.status === 'timeout',
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(completed).toMatchObject({
        status: 'timeout',
        termination: { reason: 'deadline_exceeded' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('waits for the linked workflow terminal status', async () => {
    let reads = 0;
    service.setDeps({
      workflowRunService: {
        startWorkflowRun: async () => ({
          ok: true,
          runId: 'workflow-run-wait',
          sessionKey: 'agent:main:webchat:workflow-run-wait',
        }),
        readWorkflowRunView: async () => ({
          run: {
            id: 'workflow-run-wait',
            status: ++reads >= 2 ? 'succeeded' : 'running',
          },
        } as never),
      },
    });
    const automation = await service.create({
      name: 'Wait for workflow',
      trigger: { kind: 'manual' },
      action: { kind: 'workflow', workflowId: 'review' },
    });

    const queued = await service.runNow(automation.id);
    const completed = await waitFor(
      () => service.getRun(queued.id),
      (run) => run?.status === 'succeeded',
    );

    expect(reads).toBeGreaterThanOrEqual(2);
    expect(completed?.summary).toBe('Workflow run workflow-run-wait completed');
  });

  it('retries a failed action within the same durable run', async () => {
    let calls = 0;
    service.setDeps({
      agentService: {
        turnDispatcher: {
          processDirect: async () => {
            calls += 1;
            if (calls === 1) throw new Error('temporary provider failure');
            return 'recovered';
          },
        },
      },
    });
    const automation = await service.create({
      name: 'Retry provider failure',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'try again' },
      reliability: { retryCount: 1 },
    });

    const queued = await service.runNow(automation.id);
    const completed = await waitFor(
      () => service.getRun(queued.id),
      (run) => run?.status === 'succeeded',
    );

    expect(calls).toBe(2);
    expect(completed).toMatchObject({ status: 'succeeded', attemptNumber: 2, rootRunId: queued.id });
    expect((await service.listRunEvents(queued.id)).map((event) => event.type))
      .toContain('action.retry_scheduled');
  });

  it('reclaims a queued durable run after service restart', async () => {
    const automation = await service.create({
      name: 'Recover queued run',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'resume after restart' },
    });
    const runId = 'queued-before-restart';
    saveAutomationRun({
      id: runId,
      rootRunId: runId,
      attemptNumber: 1,
      automationId: automation.id,
      automationName: automation.name,
      status: 'queued',
      triggerSnapshot: automation.trigger,
      actionSnapshot: automation.action,
      manual: false,
      createdAtMs: Date.now(),
    });
    await service.update(automation.id, { state: { runningRunId: runId } });
    await service.stop();

    service = new AutomationService();
    service.setDeps({
      getDefaultAgentId: () => 'main',
      agentService: { turnDispatcher: { processDirect: async () => 'resumed' } },
    });
    await service.initialize();
    const recovered = await waitFor(
      () => service.getRun(runId),
      (run) => run?.status === 'succeeded',
    );

    expect(recovered).toMatchObject({ status: 'succeeded', summary: 'resumed' });
    expect((await service.listRunEvents(runId)).map((event) => event.type)).toContain('run.recovered');
  });

  it('prepares project-bound agent sessions before applying session overrides', async () => {
    const applyAutomationWorkingDirectory = vi.fn(async () => undefined);
    const prepareAgentSession = vi.fn(async () => undefined);
    const workflowCalls: unknown[] = [];
    service.setDeps({
      prepareAgentSession,
      agentService: {
        sessionConfig: {
          applyAutomationWorkingDirectory,
        },
        turnDispatcher: {
          processDirect: async (message) => `done: ${message}`,
        },
      },
      workflowRunService: {
        startWorkflowRun: async (params) => {
          workflowCalls.push(params);
          return { ok: true, runId: 'workflow-run-1', sessionKey: 'agent:main:webchat:workflow-run-1' };
        },
      },
    });

    const agentAutomation = await service.create({
      name: 'Project agent',
      projectId: 'project-a',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'check workspace' },
    });
    const agentRun = await service.runNow(agentAutomation.id);
    await waitFor(
      () => service.listRuns({ automationId: agentAutomation.id, limit: 5 }),
      (items) => items.some((item) => item.id === agentRun.id && item.status === 'succeeded'),
    );
    expect(prepareAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a',
      automationId: agentAutomation.id,
      runId: agentRun.id,
    }));
    expect(applyAutomationWorkingDirectory).toHaveBeenCalledWith(expect.any(String), undefined);
    expect(prepareAgentSession.mock.invocationCallOrder[0]).toBeLessThan(
      applyAutomationWorkingDirectory.mock.invocationCallOrder[0]!,
    );

    const workflowAutomation = await service.create({
      name: 'Project workflow',
      projectId: 'project-a',
      safety: { mode: 'auto_apply' },
      trigger: { kind: 'manual' },
      action: { kind: 'workflow', workflowId: 'review' },
    });
    const workflowRun = await service.runNow(workflowAutomation.id);
    await waitFor(
      () => service.listRuns({ automationId: workflowAutomation.id, limit: 5 }),
      (items) => items.some((item) => item.id === workflowRun.id && item.status === 'succeeded'),
    );
    expect(workflowCalls[0]).toMatchObject({ projectId: 'project-a' });

    const projectAutomations = await service.list({ projectId: 'project-a' });
    expect(projectAutomations.map((automation) => automation.id).sort()).toEqual([
      agentAutomation.id,
      workflowAutomation.id,
    ].sort());
    expect(await service.listRuns({ projectId: 'project-a', limit: 10 })).toHaveLength(2);
  });

  it('tracks read results and marks them within the selected project', async () => {
    const first = await service.create({
      name: 'First project brief',
      projectId: 'project-a',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'first' },
    });
    const second = await service.create({
      name: 'Second project brief',
      projectId: 'project-b',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'second' },
    });
    const firstRun = await service.runNow(first.id);
    const secondRun = await service.runNow(second.id);
    await waitFor(() => service.getRun(firstRun.id), (run) => run?.status === 'succeeded');
    await waitFor(() => service.getRun(secondRun.id), (run) => run?.status === 'succeeded');

    expect(await service.markRunRead(firstRun.id)).toBe(true);
    expect((await service.getRun(firstRun.id))?.readAtMs).toBeTypeOf('number');
    expect((await service.getRun(secondRun.id))?.readAtMs).toBeUndefined();

    expect(await service.markAllRunsRead({ projectId: 'project-b' })).toBe(1);
    expect((await service.getRun(secondRun.id))?.readAtMs).toBeTypeOf('number');
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
    expect(completed?.summary).toContain('Do not modify files, notes, Tasks, workflows, external systems, or persistent state.');
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
        eventType: 'task.attention_required.v2',
        source: 'tasks',
        payloadMatch: { reason: 'blocked' },
      },
      action: { kind: 'agent', instruction: 'analyze the blocked goal' },
    });

    const ignored = await service.triggerEvent({
      type: 'task.attention_required.v2',
      source: 'tasks',
      payload: { reason: 'informational' },
    });
    expect(ignored).toHaveLength(0);

    const started = await service.triggerEvent({
      type: 'task.attention_required.v2',
      source: 'tasks',
      payload: { reason: 'blocked', taskId: 'goal-1' },
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
      message: 'Event task.attention_required.v2 queued automation',
    });

    const productRuns = await service.listRunsForProductEvent({
      eventType: 'task.attention_required.v2',
      source: 'tasks',
      payloadKey: 'taskId',
      payloadValue: 'goal-1',
    });
    expect(productRuns).toHaveLength(1);
    expect(productRuns[0]!.run.id).toBe(started[0]!.id);
    expect(productRuns[0]!.triggerEvent).toMatchObject({
      type: 'run.queued',
      message: 'Event task.attention_required.v2 queued automation',
    });

    const rerun = await service.rerunFromRun(started[0]!.id);
    await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === rerun.id && item.status === 'succeeded'),
    );
    const productRunsAfterRerun = await service.listRunsForProductEvent({
      eventType: 'task.attention_required.v2',
      source: 'tasks',
      payloadKey: 'taskId',
      payloadValue: 'goal-1',
    });
    expect(productRunsAfterRerun.map((item) => item.run.id)).toContain(rerun.id);
  });

  it('runs a published Browser Recipe action and records its task', async () => {
    const runAndWait = vi.fn(async () => ({
      id: 'recipe-run-1',
      status: 'succeeded' as const,
      result: { title: 'Example' },
    }));
    service.setDeps({ browserRecipeService: { runAndWait } });
    const automation = await service.create({
      name: 'Collect page title',
      trigger: { kind: 'manual' },
      action: { kind: 'browser_recipe', recipeId: 'collect-title', args: { query: 'xopc' } },
    });

    const queued = await service.runNow(automation.id);
    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );

    expect(runAndWait).toHaveBeenCalledWith('collect-title', { query: 'xopc' }, expect.any(AbortSignal));
    expect(runs.find((item) => item.id === queued.id)?.summary).toContain('"title":"Example"');
  });
});
