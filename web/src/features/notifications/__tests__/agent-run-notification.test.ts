import { describe, expect, it } from 'vitest';

import {
  buildAgentRunNotification,
  parseAgentRunEndedEvent,
} from '@/features/notifications/agent-run-notification';

const event = {
  schemaVersion: 1 as const,
  runId: 'run-1',
  sessionKey: 'agent:main:webchat:default:direct:one',
  status: 'success' as const,
  completedAtMs: 1,
  route: '/chat/agent%3Amain%3Awebchat%3Adefault%3Adirect%3Aone',
  source: 'webchat' as const,
  sessionTitle: 'Research notifications',
};

describe('agent run notification', () => {
  it('validates and presents a terminal event', () => {
    expect(parseAgentRunEndedEvent(event)).toEqual(event);
    expect(buildAgentRunNotification(event, 'en')).toMatchObject({
      id: 'agent-run:run-1',
      body: 'Research notifications',
      status: 'success',
    });
  });

  it('suppresses cancelled runs and rejects unsafe routes', () => {
    expect(buildAgentRunNotification({ ...event, status: 'cancelled' }, 'en')).toBeNull();
    expect(parseAgentRunEndedEvent({ ...event, route: 'https://example.com' })).toBeNull();
  });
});
