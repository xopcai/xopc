import { describe, expect, it } from 'vitest';

import type { AgentRunNotification } from '@/features/notifications/agent-run-notification';
import { decideNotification } from '@/features/notifications/notification-policy';

const notification: AgentRunNotification = {
  id: 'agent-run:r1',
  title: 'Done',
  body: 'Task',
  route: '/chat/session',
  status: 'success',
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
