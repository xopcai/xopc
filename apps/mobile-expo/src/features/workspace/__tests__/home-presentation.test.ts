import { describe, expect, it } from 'vitest';

import {
  homeGreetingPeriod,
  mobileRouteForHomeHref,
  partitionHomeBackground,
  rankHomeContinueCandidates,
} from '../home-presentation';

describe('home presentation', () => {
  it('prefers recently used content over background work and removes the focused item', () => {
    const now = 2_000_000_000;
    const ranked = rankHomeContinueCandidates([
      { id: 'workflow:1', kind: 'running_work', updatedAt: now, value: 'workflow' },
      { id: 'session:1', kind: 'recent_chat', updatedAt: now - 1_000, value: 'session' },
      { id: 'note:1', kind: 'note', updatedAt: now - 2_000, value: 'note' },
    ], 'note:1', now);

    expect(ranked).toEqual(['session', 'workflow']);
  });

  it('orders active conversations before other running work when user activity is stale', () => {
    const now = 2_000_000_000;
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1_000);
    const ranked = rankHomeContinueCandidates([
      { id: 'workflow:1', kind: 'running_work', updatedAt: now, value: 'workflow' },
      { id: 'session:1', kind: 'recent_chat', updatedAt: twoDaysAgo, value: 'session' },
      { id: 'conversation:1', kind: 'active_chat', updatedAt: now - 1_000, value: 'conversation' },
    ], undefined, now);

    expect(ranked).toEqual(['conversation', 'workflow', 'session']);
  });

  it('uses stable day periods for the workspace greeting', () => {
    expect(homeGreetingPeriod(0)).toBe('morning');
    expect(homeGreetingPeriod(11)).toBe('morning');
    expect(homeGreetingPeriod(12)).toBe('afternoon');
    expect(homeGreetingPeriod(17)).toBe('afternoon');
    expect(homeGreetingPeriod(18)).toBe('evening');
    expect(homeGreetingPeriod(23)).toBe('evening');
  });

  it('keeps proactive insights and schedules visible instead of treating them as running work', () => {
    const result = partitionHomeBackground([
      { id: 'run', kind: 'running' as const },
      { id: 'insight', kind: 'insight' as const },
      { id: 'schedule', kind: 'scheduled' as const },
    ]);

    expect(result.running.map((item) => item.id)).toEqual(['run']);
    expect(result.updates.map((item) => item.id)).toEqual(['insight', 'schedule']);
  });

  it('maps every home target to its concrete native destination', () => {
    expect(mobileRouteForHomeHref('/tasks/task-1')).toBe('/tasks/task-1');
    expect(mobileRouteForHomeHref('/workflows?runId=run-1')).toBe('/workflows/runs/run-1');
    expect(mobileRouteForHomeHref('/automations?automation=morning')).toBe('/automation/morning');
    expect(mobileRouteForHomeHref('/automations?automation=morning&run=run-1')).toBe('/automation/runs/run-1');
    expect(mobileRouteForHomeHref('/notes?status=inbox')).toBe('/inbox');
  });
});
