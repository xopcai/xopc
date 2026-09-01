import { describe, expect, it } from 'vitest';

import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  it('allows app-owned activity routes', () => {
    expect(resolveNotificationRoute({ target: { kind: 'chat', sessionKey: 'agent:main' } }))
      .toBe('/chat/agent%3Amain');
    expect(resolveNotificationRoute({ target: { kind: 'task', taskId: 'work-123' } }))
      .toBe('/tasks/work-123');
    expect(resolveNotificationRoute({
      target: { kind: 'automation_run', automationId: 'automation-1', runId: 'run 1' },
    })).toBe('/automation/runs/run%201');
    expect(resolveNotificationRoute({ target: { kind: 'insight', inboxItemId: 'insight-1' } }))
      .toBe('/inbox?item=insight-1');
  });

  it('rejects arbitrary or malformed routes from a push payload', () => {
    expect(resolveNotificationRoute({ target: { kind: 'unknown', id: '1' } })).toBeNull();
    expect(resolveNotificationRoute({ target: { kind: 'chat', sessionKey: '' } })).toBeNull();
    expect(resolveNotificationRoute({ route: '/chat/session' })).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
  });
});
