import { describe, expect, it } from 'vitest';

import { buildHomeWorkbench, decisionFromTask } from '../home.js';

describe('home workbench', () => {
  it('keeps decisions and failures in the user-attention layer', () => {
    const workbench = buildHomeWorkbench({
      locale: 'zh-CN',
      decisions: [{
        id: 'connector-approval:approval-1',
        kind: 'connector_approval',
        title: 'github.publish',
        detail: 'github · repository:write',
        reason: 'approval_required',
        urgency: 'now',
        href: '/connectors',
        updatedAt: 200,
        response: { kind: 'connector_approval', approvalId: 'approval-1' },
      }],
      attention: [{ id: 'failed', kind: 'automation_run', runId: 'failed', title: 'Report', reason: 'run_failed', href: '/automations?run=failed', updatedAt: 300 }],
      runningTasks: [],
      scheduled: [],
      nowMs: 400,
    });

    expect(workbench.needsUser.map((item) => item.kind)).toEqual(['decision', 'failure']);
    expect(workbench.needsUser[0]?.primaryAction).toEqual({
      type: 'connector_decision',
      label: '允许并继续',
      approvalId: 'approval-1',
      decision: 'approve',
    });
    expect(workbench.needsUser[1]?.recommendation).toContain('重试');
    expect(workbench.background).toEqual([]);
    expect(workbench.backgroundCount).toBe(0);
  });

  it('offers inline task review and retry while preserving detail navigation', () => {
    const workbench = buildHomeWorkbench({
      locale: 'zh',
      decisions: [
        { id: 'review', kind: 'task', title: 'Report', reason: 'decision_needed', urgency: 'now', href: '/tasks/review', updatedAt: 2,
          response: { kind: 'task', taskId: 'review', canRetry: false } },
        { id: 'failed', kind: 'task', title: 'Chart', reason: 'retry', urgency: 'now', href: '/tasks/failed', updatedAt: 1,
          response: { kind: 'task', taskId: 'failed', canRetry: true } },
        { id: 'waiting', kind: 'task', title: 'Waiting', reason: 'retry', urgency: 'now', href: '/tasks/waiting', updatedAt: 0,
          response: { kind: 'task', taskId: 'waiting', canRetry: false } },
      ],
      attention: [], runningTasks: [], scheduled: [], nowMs: 3,
    });
    expect(workbench.needsUser[0]?.primaryAction).toEqual({ type: 'task_review', taskId: 'review', label: '查看结果并验收' });
    expect(workbench.needsUser[1]?.primaryAction).toEqual({ type: 'retry_task', taskId: 'failed', label: '重试' });
    expect(workbench.needsUser[1]?.secondaryActions).toEqual([{ type: 'open', href: '/tasks/failed', label: '查看并处理' }]);
    expect(workbench.needsUser[2]?.primaryAction?.type).toBe('open');
  });

  it('allows a genuinely quiet empty state', () => {
    const workbench = buildHomeWorkbench({
      locale: 'en',
      decisions: [],
      attention: [],
      runningTasks: [],
      scheduled: [],
      nowMs: 500,
    });

    expect(workbench).toEqual({ needsUser: [], background: [], backgroundCount: 0 });
  });

  it('returns all background work so the client can expand beyond three rows', () => {
    const workbench = buildHomeWorkbench({
      locale: 'en',
      decisions: [],
      attention: [],
      runningTasks: [],
      scheduled: [
        { id: 'morning', trigger: '0 8 * * *', action: 'agent:main', nextRunAt: '2026-08-29T00:00:00.000Z' },
        { id: 'noon', trigger: '0 12 * * *', action: 'agent:main', nextRunAt: '2026-08-29T04:00:00.000Z' },
        { id: 'evening', trigger: '0 18 * * *', action: 'agent:main', nextRunAt: '2026-08-29T10:00:00.000Z' },
      ],
      nowMs: 500,
    });

    expect(workbench.backgroundCount).toBe(3);
    expect(workbench.background).toHaveLength(3);
    expect(workbench.background.map((item) => item.kind)).toEqual(['scheduled', 'scheduled', 'scheduled']);
  });

  it('localizes known system failures while preserving arbitrary task details', () => {
    const model = {
      task: {
        id: 'task-1', title: '查询 Connector', phase: 'active' as const, priority: 'normal' as const,
        source: 'user' as const, locale: 'en' as const, latestContractVersion: 1, boardRank: 1024,
        version: 2, createdAt: 100, updatedAt: 200,
      },
      operationalState: 'idle' as const,
      attention: [{ kind: 'run_failed' as const, summary: 'Agent run returned no result or evidence', sourceId: 'run-1' }],
      allowedCommands: [],
    };
    expect(decisionFromTask(model, undefined, 'zh-CN')?.detail).toBe('本次执行没有返回结果或依据，请重试。');
    expect(decisionFromTask(model, undefined, 'en')?.detail).toBe('Agent run returned no result or evidence');
    model.attention[0]!.summary = 'Connector authentication expired';
    expect(decisionFromTask(model, undefined, 'zh')?.detail).toBe('Connector authentication expired');
  });

  it('turns a completed manual task into a review decision', () => {
    const decision = decisionFromTask({
      task: {
        id: 'task-1',
        title: 'Weekly report',
        phase: 'review',
        priority: 'normal',
        source: 'user',
        locale: 'en',
        latestContractVersion: 1,
        boardRank: 1024,
        version: 2,
        createdAt: 100,
        updatedAt: 200,
      },
      operationalState: 'idle',
      attention: [],
      allowedCommands: [],
    });

    expect(decision).toMatchObject({
      id: 'task:task-1:review',
      reason: 'decision_needed',
      detail: 'The work is complete and ready for your review.',
    });
  });
  it.each(['input_required', 'approval_required', 'dependency_blocked'] as const)('prioritizes %s over review when a task still has a wait', (kind) => {
    const model = { task: { id: 'waiting-review', title: 'Waiting review', phase: 'review', updatedAt: 1 }, operationalState: 'waiting', attention: [{ kind, summary: 'Resolve this wait first' }], allowedCommands: ['resolve_wait', 'close'] } as Parameters<typeof decisionFromTask>[0];
    const decision = decisionFromTask(model, undefined, 'en');
    expect(decision?.reason).toBe(({ input_required: 'needs_input', approval_required: 'approval_required', dependency_blocked: 'dependency' })[kind]);
    expect(decision?.detail).toBe('Resolve this wait first');
  });

  it('retains paused tasks as reachable background items with their wait reason', () => {
    const task = { id: 'paused-task', title: 'Paused', updatedAt: 1 } as Parameters<typeof buildHomeWorkbench>[0]['runningTasks'][number];
    const home = buildHomeWorkbench({ locale: 'en', decisions: [], attention: [], runningTasks: [task], waitingTaskReasons: { 'paused-task': 'Paused by user' }, scheduled: [], nowMs: 1 });
    expect(home.background[0]).toMatchObject({ summary: 'Paused by user', statusLabel: 'Waiting', openAction: { type: 'open', href: '/tasks/paused-task' } });
  });

});
