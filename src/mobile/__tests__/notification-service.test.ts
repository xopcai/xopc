import { describe, expect, it } from 'vitest';

import { mobileNotificationEventFromGatewayEvent } from '../notification-service.js';

describe('mobileNotificationEventFromGatewayEvent', () => {
  it('maps an input-needed goal to its active chat session', () => {
    expect(mobileNotificationEventFromGatewayEvent('goal.status.updated', {
      goal: { id: 'goal-1', title: 'Approve deployment', activeSessionKey: 'agent:main:chat/1' },
      status: 'needs_input',
    })).toMatchObject({
      type: 'goal.needs_input',
      entity: { kind: 'goal', id: 'goal-1' },
      priority: 'high',
      deepLink: '/chat/agent%3Amain%3Achat%2F1',
      payload: { route: '/chat/agent%3Amain%3Achat%2F1' },
    });
  });

  it('maps failed and successful automation runs to the activity stream', () => {
    const failed = mobileNotificationEventFromGatewayEvent('automation.run.completed', {
      run: { id: 'run-1', automationId: 'automation-1', automationName: 'Nightly backup', status: 'failed' },
    });
    const succeeded = mobileNotificationEventFromGatewayEvent('automation.run.completed', {
      run: { id: 'run-2', automationId: 'automation-1', automationName: 'Nightly backup', status: 'succeeded' },
    });

    expect(failed).toMatchObject({
      type: 'automation.failed',
      priority: 'high',
      deepLink: '/automation',
    });
    expect(succeeded).toMatchObject({
      type: 'automation.completed',
      priority: 'normal',
      deepLink: '/automation',
    });
  });

  it('ignores unrelated events and invalid status payloads', () => {
    expect(mobileNotificationEventFromGatewayEvent('session.updated', {})).toBeNull();
    expect(mobileNotificationEventFromGatewayEvent('goal.status.updated', {
      goalId: 'goal-1',
      status: 'running',
    })).toBeNull();
    expect(mobileNotificationEventFromGatewayEvent('automation.run.completed', {
      silent: true,
      run: { id: 'run-2', automationId: 'focus-1', automationName: 'Focus watch', status: 'succeeded' },
    })).toBeNull();
  });
});
