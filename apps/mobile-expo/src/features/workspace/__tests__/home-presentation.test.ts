import { describe, expect, it } from 'vitest';

import { mobileRouteForHomeHref, rankHomeContinueCandidates } from '../home-presentation';

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

  it('maps every home target to its concrete native destination', () => {
    expect(mobileRouteForHomeHref('/tasks/task-1')).toBe('/tasks/task-1');
    expect(mobileRouteForHomeHref('/workflows?runId=run-1')).toBe('/workflows/runs/run-1');
    expect(mobileRouteForHomeHref('/automations?automation=morning')).toBe('/automation/morning');
    expect(mobileRouteForHomeHref('/automations?automation=morning&run=run-1')).toBe('/automation/runs/run-1');
    expect(mobileRouteForHomeHref('/notes?status=inbox')).toBe('/inbox');
  });
});
