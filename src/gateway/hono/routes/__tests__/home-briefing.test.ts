import { describe, expect, it } from 'vitest';

import { buildHomeBriefing, buildHomeFocusItems } from '../home.js';

describe('home briefing', () => {
  it('summarizes decisions and background progress in the requested locale', () => {
    const briefing = buildHomeBriefing({
      locale: 'zh-CN',
      decisions: [
        {
          id: 'task:1',
          kind: 'task',
          title: '确认发布范围',
          reason: 'needs_input',
          urgency: 'now',
          href: '/tasks/1',
          updatedAt: 100,
        },
      ],
      attention: [],
      activeWorkflowCount: 1,
      activeTaskCount: 3,
      wins: [],
      nextScheduled: undefined,
      inboxCount: 0,
      nowMs: 400,
      nowMs: 200,
    });

    expect(briefing.summary).toBe('有 1 件事需要你处理；我正在继续推进 4 件工作。');
    expect(briefing.focus).toHaveLength(1);
    expect(briefing.progress).toEqual({
      activeWorkflowCount: 1,
      activeTaskCount: 3,
      movingCount: 4,
    });
  });

  it('keeps the briefing calm when nothing needs the user', () => {
    const briefing = buildHomeBriefing({
      locale: 'en',
      decisions: [],
      attention: [],
      activeWorkflowCount: 0,
      activeTaskCount: 1,
      wins: [],
      nowMs: 200,
    });

    expect(briefing.summary).toBe("Nothing needs you right now; I’m continuing 1 item in the background.");
    expect(briefing.focus).toEqual([]);
  });

  it('shows a result-oriented empty state', () => {
    const briefing = buildHomeBriefing({
      locale: 'en',
      decisions: [],
      attention: [],
      activeWorkflowCount: 0,
      activeTaskCount: 0,
      wins: [],
      nowMs: 200,
    });

    expect(briefing.summary).toContain('Hand me an task');
  });

  it('includes run issues in the attention summary without treating them as decisions', () => {
    const briefing = buildHomeBriefing({
      locale: 'en',
      decisions: [],
      attention: [{
        id: 'automation_run:run-1',
        kind: 'automation_run',
        runId: 'run-1',
        title: 'Daily report',
        detail: 'The run exceeded 5 minutes and was stopped.',
        reason: 'run_timeout',
        href: '/automations?run=run-1',
        updatedAt: 100,
      }],
      activeWorkflowCount: 0,
      activeTaskCount: 0,
      wins: [],
      nowMs: 200,
    });

    expect(briefing.summary).toBe('1 item needs your attention.');
    expect(briefing.focus).toEqual([]);
  });
});

describe('home focus items', () => {
  it('prioritizes decisions and exposes executable connector actions', () => {
    const items = buildHomeFocusItems({
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
      wins: [],
      inboxCount: 0,
      nowMs: 400,
    });

    expect(items.map((item) => item.kind)).toEqual(['decision', 'failure']);
    expect(items[0]?.primaryAction).toEqual({
      type: 'connector_decision',
      label: '允许并继续',
      approvalId: 'approval-1',
      decision: 'approve',
    });
    expect(items[1]?.secondaryActions[0]?.type).toBe('acknowledge_run');
  });

  it('offers one useful suggestion only when no work is active', () => {
    const items = buildHomeFocusItems({
      locale: 'en',
      decisions: [],
      attention: [],
      activeWorkflowRuns: [],
      runningTasks: [],
      wins: [],
      inboxCount: 0,
      nowMs: 500,
    });

    expect(items).toEqual([expect.objectContaining({
      id: 'suggestion:ask-agent',
      kind: 'suggestion',
      primaryAction: { type: 'ask_ai', label: 'Ask an agent' },
    })]);
  });

  it('prefers organizing captured content over a generic idle suggestion', () => {
    const items = buildHomeFocusItems({
      locale: 'zh-CN',
      decisions: [],
      attention: [],
      activeWorkflowRuns: [],
      runningTasks: [],
      wins: [],
      inboxCount: 3,
      nowMs: 600,
    });

    expect(items[0]).toMatchObject({
      id: 'suggestion:organize-inbox',
      title: '整理收件箱 · 3',
      primaryAction: { type: 'open', target: 'inbox' },
    });
  });
});
