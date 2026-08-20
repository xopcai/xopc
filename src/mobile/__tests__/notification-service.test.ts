import { describe, expect, it } from 'vitest';

import { mobileNotificationEventFromGatewayEvent } from '../notification-service.js';

describe('mobileNotificationEventFromGatewayEvent', () => {
  it('maps an input-needed task to its task detail', () => {
    expect(mobileNotificationEventFromGatewayEvent('task.attention_required.v2', {
      task: { id: 'task-1', title: 'Approve deployment' },
      reason: 'user_input',
    })).toMatchObject({
      type: 'task.needs_input',
      entity: { kind: 'task', id: 'task-1' },
      priority: 'high',
      deepLink: '/tasks/task-1',
      payload: { route: '/tasks/task-1' },
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

  it('maps a proactive insight to the decision inbox', () => {
    expect(mobileNotificationEventFromGatewayEvent('proactive.inbox.created', {
      id: 'inbox-1',
      insight: { id: 'insight-1', title: 'Delivery risk needs a decision', summary: 'Two blockers now threaten the release.', urgency: 'high' },
    })).toMatchObject({
      type: 'proactive.insight',
      entity: { kind: 'insight', id: 'insight-1' },
      priority: 'high',
      deepLink: '/inbox?item=inbox-1',
      payload: { route: '/inbox?item=inbox-1', inboxItemId: 'inbox-1' },
    });
  });

  it('ignores unrelated events and invalid status payloads', () => {
    expect(mobileNotificationEventFromGatewayEvent('session.updated', {})).toBeNull();
    expect(mobileNotificationEventFromGatewayEvent('task.phase_changed.v2', {
      taskId: 'task-1',
      from: 'ready',
      to: 'active',
    })).toBeNull();
    expect(mobileNotificationEventFromGatewayEvent('automation.run.completed', {
      silent: true,
      run: { id: 'run-2', automationId: 'automation-1', automationName: 'Silent run', status: 'succeeded' },
    })).toBeNull();
  });
});
