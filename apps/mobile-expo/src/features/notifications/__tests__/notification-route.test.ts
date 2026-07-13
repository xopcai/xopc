import { describe, expect, it } from 'vitest';

import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  it('allows app-owned activity routes', () => {
    expect(resolveNotificationRoute({ route: '/' })).toBe('/');
    expect(resolveNotificationRoute({ route: '/automation' })).toBe('/automation');
    expect(resolveNotificationRoute({ route: '/chat/agent%3Amain' })).toBe('/chat/agent%3Amain');
  });

  it('rejects arbitrary or malformed routes from a push payload', () => {
    expect(resolveNotificationRoute({ route: 'https://example.com' })).toBeNull();
    expect(resolveNotificationRoute({ route: '/settings' })).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
  });
});
