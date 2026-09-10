import { describe, expect, it } from 'vitest';

import { mobileRouteForWorkbenchHref } from '../workbench-route';

describe('mobileRouteForWorkbenchHref', () => {
  it('maps gateway workbench links to native routes', () => {
    expect(mobileRouteForWorkbenchHref('/tasks/task-1')).toBe('/tasks/task-1');
    expect(mobileRouteForWorkbenchHref('/chat/session-1')).toBe('/chat/session-1');
    expect(mobileRouteForWorkbenchHref('/workflows?runId=run-1')).toBe('/workflows/runs/run-1');
    expect(mobileRouteForWorkbenchHref('/automations?automation=morning')).toBe('/automation/morning');
    expect(mobileRouteForWorkbenchHref('/automations?automation=morning&run=run-1')).toBe('/automation/runs/run-1');
    expect(mobileRouteForWorkbenchHref('/notes?status=inbox')).toBe('/inbox');
  });
});
