import { describe, expect, it } from 'vitest';

import {
  localizeNotification,
  notificationTargetRoute,
  parseNotificationTarget,
  ProductNotificationSchema,
  type NotificationTarget,
} from './notifications.js';

describe('notification targets', () => {
  const cases: Array<{
    target: NotificationTarget;
    web: string;
    mobile: string;
  }> = [
    {
      target: { kind: 'chat', sessionKey: 'agent:main' },
      web: '/chat/agent%3Amain',
      mobile: '/chat/agent%3Amain',
    },
    {
      target: { kind: 'task', taskId: 'task one' },
      web: '/tasks/task%20one',
      mobile: '/tasks/task%20one',
    },
    {
      target: { kind: 'automation_run', automationId: 'auto one', runId: 'run/one' },
      web: '/automations?automation=auto%20one&run=run%2Fone',
      mobile: '/automation/runs/run%2Fone',
    },
    {
      target: { kind: 'insight', inboxItemId: 'item?one' },
      web: '/inbox?item=item%3Fone',
      mobile: '/inbox?item=item%3Fone',
    },
  ];

  it.each(cases)('derives safe routes for $target.kind', ({ target, web, mobile }) => {
    expect(notificationTargetRoute(target, 'web')).toBe(web);
    expect(notificationTargetRoute(target, 'mobile')).toBe(mobile);
  });

  it('rejects malformed or unknown targets', () => {
    expect(parseNotificationTarget({ kind: 'chat', sessionKey: '' })).toBeNull();
    expect(parseNotificationTarget({ kind: 'unknown', id: 'one' })).toBeNull();
    expect(parseNotificationTarget('/chat/unsafe')).toBeNull();
  });

  it('validates and localizes the cross-surface event contract', () => {
    const notification = ProductNotificationSchema.parse({
      schemaVersion: 1,
      id: 'notification-1',
      type: 'chat.completed',
      target: { kind: 'chat', sessionKey: 'session-1' },
      priority: 'normal',
      title: { en: 'Response ready', zh: '回答已就绪' },
      body: { en: 'Open the conversation', zh: '打开对话查看' },
      payload: { runId: 'run-1' },
      createdAt: 1,
    });
    expect(localizeNotification(notification, 'zh')).toMatchObject({
      localizedTitle: '回答已就绪',
      localizedBody: '打开对话查看',
    });
  });
});
