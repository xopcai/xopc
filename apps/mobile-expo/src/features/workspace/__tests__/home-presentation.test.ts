import { describe, expect, it } from 'vitest';

import {
  homeGreetingPeriod,
  mobileRouteForHomeHref,
  rankHomeContinueCandidates,
  rankHomeRunningCandidates,
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

  it('uses stable day periods for the workspace greeting', () => {
    expect(homeGreetingPeriod(0)).toBe('morning');
    expect(homeGreetingPeriod(11)).toBe('morning');
    expect(homeGreetingPeriod(12)).toBe('afternoon');
    expect(homeGreetingPeriod(17)).toBe('afternoon');
    expect(homeGreetingPeriod(18)).toBe('evening');
    expect(homeGreetingPeriod(23)).toBe('evening');
  });

  it('keeps executing conversations ahead of other background work', () => {
    const ranked = rankHomeRunningCandidates([
      { id: 'task:1', kind: 'work', updatedAt: 300, value: 'task' },
      { id: 'session:1', kind: 'conversation', updatedAt: 100, value: 'conversation' },
      { id: 'workflow:1', kind: 'work', updatedAt: 200, value: 'workflow' },
    ]);

    expect(ranked).toEqual(['conversation', 'task', 'workflow']);
  });

  it('maps every home target to its concrete native destination', () => {
    expect(mobileRouteForHomeHref('/tasks/task-1')).toBe('/tasks/task-1');
    expect(mobileRouteForHomeHref('/workflows?runId=run-1')).toBe('/workflows/runs/run-1');
    expect(mobileRouteForHomeHref('/automations?automation=morning')).toBe('/automation/morning');
    expect(mobileRouteForHomeHref('/automations?automation=morning&run=run-1')).toBe('/automation/runs/run-1');
    expect(mobileRouteForHomeHref('/notes?status=inbox')).toBe('/inbox');
  });
});
