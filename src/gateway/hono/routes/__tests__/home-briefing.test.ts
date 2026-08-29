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
      attention: [{
        id: 'workflow_run:run-1',
        kind: 'workflow_run',
        runId: 'run-1',
        title: 'Research',
        detail: 'The workflow failed.',
        reason: 'run_failed',
        href: '/workflows?runId=run-1',
        updatedAt: 300,
      }],
      activeWorkflowRuns: [],
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

  it('allows a genuinely quiet empty state', () => {
    const workbench = buildHomeWorkbench({
      locale: 'en',
      decisions: [],
      attention: [],
      activeWorkflowRuns: [],
      runningTasks: [],
      scheduled: [],
      nowMs: 500,
    });

    expect(workbench).toEqual({ needsUser: [], background: [], backgroundCount: 0 });
  });

  it('counts all background work while returning only the first three rows', () => {
    const workbench = buildHomeWorkbench({
      locale: 'en',
      decisions: [],
      attention: [],
      activeWorkflowRuns: [{
        id: 'run-1',
        definitionId: 'workflow-1',
        title: 'Research',
        status: 'running',
        createdAtMs: 100,
        metrics: { agentCount: 2, doneAgentCount: 1, errorAgentCount: 0, skippedAgentCount: 0, artifactCount: 0 },
      }],
      runningTasks: [],
      scheduled: [
        { id: 'morning', trigger: '0 8 * * *', action: 'agent:main', nextRunAt: '2026-08-29T00:00:00.000Z' },
        { id: 'noon', trigger: '0 12 * * *', action: 'agent:main', nextRunAt: '2026-08-29T04:00:00.000Z' },
        { id: 'evening', trigger: '0 18 * * *', action: 'agent:main', nextRunAt: '2026-08-29T10:00:00.000Z' },
      ],
      nowMs: 500,
    });

    expect(workbench.backgroundCount).toBe(4);
    expect(workbench.background).toHaveLength(3);
    expect(workbench.background.map((item) => item.kind)).toEqual(['running', 'scheduled', 'scheduled']);
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
});
