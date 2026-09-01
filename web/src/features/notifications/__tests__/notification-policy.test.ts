import { describe, expect, it } from 'vitest';

import { decideNotification } from '@/features/notifications/notification-policy';
import type { ProductNotificationPresentation } from '@/features/notifications/product-notification';

const notification: ProductNotificationPresentation = {
  id: 'agent-run:r1',
  title: 'Done',
  body: 'Task',
  route: '/chat/session',
  target: { kind: 'chat', sessionKey: 'session' },
  status: 'success',
  source: 'chat',
};

describe('decideNotification', () => {
  const enabled = { enabled: true, completed: true, failed: true };

  it('allows an enabled background notification once', () => {
    expect(decideNotification({
      notification,
      preferences: enabled,
      permissionGranted: true,
      appFocused: false,
      alreadyDelivered: false,
    })).toEqual({ notify: true });
  });

  it.each([
    [{ ...enabled, enabled: false }, true, false, false, 'disabled'],
    [{ ...enabled, completed: false }, true, false, false, 'status-disabled'],
    [enabled, false, false, false, 'permission'],
    [enabled, true, true, false, 'focused'],
    [enabled, true, false, true, 'duplicate'],
  ] as const)('suppresses ineligible notifications', (
    preferences,
    permissionGranted,
    appFocused,
    alreadyDelivered,
    reason,
  ) => {
    expect(decideNotification({
      notification,
      preferences,
      permissionGranted,
      appFocused,
      alreadyDelivered,
    })).toEqual({ notify: false, reason });
  });
});
