import { describe, expect, it, vi } from 'vitest';

import { apiFetchWithStartupRetry, isStartupUnavailableBody } from '@/lib/gateway-startup-retry';

describe('gateway-startup-retry', () => {
  it('detects startup unavailable payloads', () => {
    expect(
      isStartupUnavailableBody({
        ok: false,
        code: 'STARTUP_UNAVAILABLE',
        retryable: true,
        retryAfterMs: 500,
        method: 'sessions.history',
        error: 'sessions.history unavailable during gateway startup',
      }),
    ).toBe(true);
    expect(isStartupUnavailableBody({ ok: false, error: 'nope' })).toBe(false);
  });

  it('retries 503 startup responses until success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            code: 'STARTUP_UNAVAILABLE',
            retryable: true,
            retryAfterMs: 100,
            method: 'sessions.history',
            error: 'sessions.history unavailable during gateway startup',
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const pending = apiFetchWithStartupRetry('/api/sessions/demo/history');
    await vi.advanceTimersByTimeAsync(100);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
