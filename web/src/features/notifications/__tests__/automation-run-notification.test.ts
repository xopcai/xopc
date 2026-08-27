import { describe, expect, it } from 'vitest';

import {
  buildAutomationRunNotification,
  parseAutomationRunCompletedEvent,
} from '@/features/notifications/automation-run-notification';

const completedEvent = {
  run: {
    id: 'run-1',
    automationId: 'automation-1',
    automationName: 'Daily brief',
    status: 'succeeded' as const,
    summary: 'Brief generated.',
  },
  notificationPolicy: 'all' as const,
  requiresAttention: false,
};

describe('automation run notification', () => {
  it('builds a route to the completed run', () => {
    expect(parseAutomationRunCompletedEvent(completedEvent)).toEqual(completedEvent);
    expect(buildAutomationRunNotification(completedEvent, 'en')).toMatchObject({
      id: 'automation-run:run-1',
      body: 'Brief generated.',
      route: '/automations?automation=automation-1&run=run-1',
      status: 'success',
    });
  });

  it('only shows attention notifications when attention is required', () => {
    expect(buildAutomationRunNotification({
      ...completedEvent,
      notificationPolicy: 'attention',
    }, 'en')).toBeNull();

    expect(buildAutomationRunNotification({
      ...completedEvent,
      run: { ...completedEvent.run, status: 'failed', error: 'Connection failed.' },
      notificationPolicy: 'attention',
      requiresAttention: true,
    }, 'zh')).toMatchObject({
      title: '自动化需要处理',
      status: 'error',
    });
  });

  it('suppresses disabled notifications and rejects invalid payloads', () => {
    expect(buildAutomationRunNotification({ ...completedEvent, notificationPolicy: 'none' }, 'en')).toBeNull();
    expect(parseAutomationRunCompletedEvent({ ...completedEvent, notificationPolicy: 'sometimes' })).toBeNull();
  });
});
