import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../service.js';
import { closeAllEventStreams, createEventsSSEHandler } from '../sse.js';

describe('gateway event stream shutdown', () => {
  afterEach(() => {
    closeAllEventStreams();
  });

  it('actively closes long-lived event streams during gateway shutdown', async () => {
    const unsubscribe = vi.fn();
    const service = {
      subscribe: vi.fn(() => unsubscribe),
      getEventsSince: vi.fn(() => []),
    } as unknown as GatewayService;
    const app = new Hono();
    app.get('/events', createEventsSSEHandler({ service }));

    const response = await app.request('/events');
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const connected = await reader!.read();
    expect(new TextDecoder().decode(connected.value)).toContain('event: connected');

    closeAllEventStreams();

    await expect(reader!.read()).resolves.toMatchObject({ done: true });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
