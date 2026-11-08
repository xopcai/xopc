import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayRealtimeBackend } from '../gateway-realtime-backend.js';

afterEach(() => vi.unstubAllGlobals());

describe('Gateway TUI failures', () => {
  it.each(['loadHistory', 'loadHistoryWindow', 'listSessions', 'listModels', 'resetSession'] as const)(
    '%s propagates a failed HTTP response', async (method) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), { status: 503 })));
      const backend = new GatewayRealtimeBackend({ url: 'http://audit.invalid' });
      const result = method === 'loadHistory' ? backend.loadHistory({ conversationId: 'A' })
        : method === 'loadHistoryWindow' ? backend.loadHistoryWindow({ conversationId: 'A', rowNumber: 1 })
          : method === 'resetSession' ? backend.resetSession('A') : backend[method]();
      await expect(result).rejects.toThrow('503');
    },
  );

  it('reports authentication failure distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(new GatewayRealtimeBackend({ url: 'http://audit.invalid' }).listSessions()).rejects.toThrow('authentication');
  });

  it('keeps the live subscription when stop is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false}', { status: 200 })));
    const backend = new GatewayRealtimeBackend({ url: 'http://audit.invalid' });
    const internal = backend as unknown as { activeRunId: string; unsubscribeActiveRun(): void };
    internal.activeRunId = 'run-A';
    const unsubscribe = vi.spyOn(internal, 'unsubscribeActiveRun');
    expect(await backend.abortChat({ conversationId: 'A', runId: 'run-A' })).toEqual({ ok: false });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(internal.activeRunId).toBe('run-A');
  });
});
