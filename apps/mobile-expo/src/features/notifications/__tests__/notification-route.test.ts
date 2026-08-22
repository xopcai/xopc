import { describe, expect, it } from 'vitest';

import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  it('allows app-owned activity routes', () => {
    expect(resolveNotificationRoute({ route: '/' })).toBe('/');
    expect(resolveNotificationRoute({ route: '/automation' })).toBe('/automation');
    expect(resolveNotificationRoute({ route: '/chat/agent%3Amain' })).toBe('/chat/agent%3Amain');
    expect(resolveNotificationRoute({ route: '/inbox?capture=1' })).toBe('/inbox?capture=1');
    expect(resolveNotificationRoute({ route: '/inbox?item=insight-1' })).toBe('/inbox?item=insight-1');
    expect(resolveNotificationRoute({ route: '/automation', runId: 'run 1' })).toBe('/automation?run=run%201');
    expect(resolveNotificationRoute({ route: '/tasks/work-123' })).toBe('/tasks/work-123');
    expect(resolveNotificationRoute({ route: '/projects/project-123' })).toBe('/projects/project-123');
    expect(resolveNotificationRoute({ route: '/workflows/runs/run-123?agentId=research' }))
      .toBe('/workflows/runs/run-123?agentId=research');
    expect(resolveNotificationRoute({ route: '/workflows/runs/run-123?projectId=project-123' }))
      .toBe('/workflows/runs/run-123?projectId=project-123');
    expect(resolveNotificationRoute({ route: '/notes' })).toBe('/notes');
  });

  it('rejects arbitrary or malformed routes from a push payload', () => {
    expect(resolveNotificationRoute({ route: 'https://example.com' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/settings' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/tasks/1?admin=1' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/inbox?item=1&admin=1' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/workflows/runs/1?admin=1' })).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
  });
});
