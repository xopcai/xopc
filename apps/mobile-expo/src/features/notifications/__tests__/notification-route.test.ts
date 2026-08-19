import { describe, expect, it } from 'vitest';

import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  it('allows app-owned activity routes', () => {
    expect(resolveNotificationRoute({ route: '/' })).toBe('/');
    expect(resolveNotificationRoute({ route: '/automation' })).toBe('/automation');
    expect(resolveNotificationRoute({ route: '/chat/agent%3Amain' })).toBe('/chat/agent%3Amain');
    expect(resolveNotificationRoute({ route: '/inbox?capture=1' })).toBe('/inbox?capture=1');
    expect(resolveNotificationRoute({ route: '/tasks/work-123' })).toBe('/tasks/work-123');
    expect(resolveNotificationRoute({ route: '/notes' })).toBe('/notes');
  });

  it('rejects arbitrary or malformed routes from a push payload', () => {
    expect(resolveNotificationRoute({ route: 'https://example.com' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/settings' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/tasks/1?admin=1' })).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
  });
});
