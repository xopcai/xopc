import { describe, expect, it } from 'vitest';

import {
  parseProductNotification,
  presentProductNotification,
} from '@/features/notifications/product-notification';

const event = {
  schemaVersion: 1 as const,
  id: 'notification-1',
  type: 'automation.failed' as const,
  target: { kind: 'automation_run' as const, automationId: 'auto one', runId: 'run/one' },
  priority: 'high' as const,
  title: { en: 'Automation needs attention', zh: '自动化需要处理' },
  body: { en: 'Nightly backup', zh: '夜间备份' },
  payload: { runId: 'run/one' },
  createdAt: 1,
};

describe('product notification presentation', () => {
  it('validates, localizes, and derives the web destination', () => {
    expect(parseProductNotification(event)).toEqual(event);
    expect(presentProductNotification(event, 'zh')).toMatchObject({
      title: '自动化需要处理',
      body: '夜间备份',
      route: '/automations?automation=auto%20one&run=run%2Fone',
      status: 'error',
      source: 'automation',
    });
  });

  it('rejects malformed realtime payloads', () => {
    expect(parseProductNotification({ ...event, target: { kind: 'chat', sessionKey: '' } })).toBeNull();
  });
});
