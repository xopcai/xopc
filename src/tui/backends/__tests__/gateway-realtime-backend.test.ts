import { describe, expect, it, vi } from 'vitest';

import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

import { GatewayRealtimeBackend } from '../gateway-realtime-backend.js';

describe('GatewayRealtimeBackend', () => {
  it('attaches to a queued run when the sessions topic announces it', () => {
    const backend = new GatewayRealtimeBackend({ url: 'http://127.0.0.1:19777' });
    const resumeChat = vi.spyOn(backend, 'resumeChat').mockResolvedValue(undefined);
    const internals = backend as unknown as {
      observedSessionKey: string;
      handleRealtimeEvent(event: RealtimeEventPayload): void;
    };
    internals.observedSessionKey = 'agent:main:web:chat-1';

    internals.handleRealtimeEvent({
      topic: 'sessions',
      seq: 1,
      event: 'run.started',
      data: { sessionKey: 'agent:main:web:chat-1', runId: 'run-2' },
    });

    expect(resumeChat).toHaveBeenCalledWith({
      sessionKey: 'agent:main:web:chat-1',
      runId: 'run-2',
    });
  });
});
