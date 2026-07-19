import { describe, expect, it } from 'vitest';

import { buildHomeBriefing } from '../home.js';

describe('home briefing', () => {
  it('summarizes decisions and background progress in the requested locale', () => {
    const briefing = buildHomeBriefing({
      locale: 'zh-CN',
      decisions: [
        {
          id: 'goal:1',
          kind: 'goal',
          title: '确认发布范围',
          reason: 'needs_input',
          urgency: 'now',
          href: '/goals/1',
          updatedAt: 100,
        },
      ],
      activeWorkCount: 2,
      activeWorkflowCount: 1,
      activeGoalCount: 3,
      wins: [],
      nowMs: 200,
    });

    expect(briefing.summary).toBe('有 1 件事等你决定；我正在继续推进 6 件工作。');
    expect(briefing.focus).toHaveLength(1);
    expect(briefing.progress).toEqual({
      activeWorkCount: 2,
      activeWorkflowCount: 1,
      activeGoalCount: 3,
      movingCount: 6,
    });
  });

  it('keeps the briefing calm when nothing needs the user', () => {
    const briefing = buildHomeBriefing({
      locale: 'en',
      decisions: [],
      activeWorkCount: 1,
      activeWorkflowCount: 0,
      activeGoalCount: 0,
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
      activeWorkCount: 0,
      activeWorkflowCount: 0,
      activeGoalCount: 0,
      wins: [],
      nowMs: 200,
    });

    expect(briefing.summary).toContain('Hand me an outcome');
  });
});
