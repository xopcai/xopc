import { describe, expect, it } from 'vitest';
import { notificationRoute } from '../entry/src/main/ets/common/notificationRoute';

describe('notification navigation trust boundary', () => {
  it('opens only known read-only destinations within the active Gateway', () => {
    const route = { gatewayId: 'gateway', eventId: 'event', target: { kind: 'chat', conversationId: 'conversation-1' } };
    expect(notificationRoute(JSON.stringify(route), 'gateway')).toEqual(route);
    expect(notificationRoute(JSON.stringify(route), 'other')).toBeUndefined();
    expect(notificationRoute(JSON.stringify({ ...route, target: { kind: 'home' } }), 'gateway')).toMatchObject({ target: { kind: 'home' } });
    expect(notificationRoute(JSON.stringify({ ...route, target: { kind: 'task', taskId: '../delete' } }), 'gateway')).toBeUndefined();
    expect(notificationRoute(JSON.stringify({ ...route, target: { kind: 'url', url: 'https://external.example' } }), 'gateway')).toBeUndefined();
  });
});
