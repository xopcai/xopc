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

  it('leaves automatic device delivery to the durable push queue', () => {
    expect(presentProductNotification({ ...event, payload: { deliveryMode: 'auto', deliveryChannel: 'browser' } }, 'en').systemAllowed).toBe(false);
    expect(presentProductNotification({ ...event, payload: { deliveryChannel: 'telegram' } }, 'en').systemAllowed).toBe(false);
  });

  it('opens Personal AI for its replies', () => {
    expect(presentProductNotification({ ...event, type: 'chat.completed',
      target: { kind: 'chat', conversationId: 'personal-chat', personal: true } }, 'zh').route).toBe('/personal');
  });

  it('rejects malformed realtime payloads', () => {
    expect(parseProductNotification({ ...event, target: { kind: 'chat', conversationId: '' } })).toBeNull();
  });


  it('presents failed work discovery as an understanding alert', () => {
    expect(presentProductNotification({
      ...event,
      id: 'notification-understanding',
      type: 'work_discovery.failed',
      target: { kind: 'work_discovery', runId: 'run-1', conversationId: 'session-1' },
      title: { en: 'Understanding needs attention', zh: '用户理解需要处理' },
    }, 'zh')).toMatchObject({
      status: 'error',
      source: 'understanding',
      route: '/user-model?workDiscovery=review&run=run-1',
    });
  });

  it('routes a home opportunity back to the home workspace', () => {
    expect(presentProductNotification({
      ...event,
      id: 'notification-home',
      type: 'home.opportunity',
      target: { kind: 'home' },
      title: { en: 'A timely next step is ready', zh: '有一项值得现在推进的事情' },
    }, 'zh')).toMatchObject({
      status: 'success',
      source: 'home',
      route: '/',
    });
  });
});
