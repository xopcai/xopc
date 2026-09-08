import { afterEach, describe, expect, it, vi } from 'vitest';

import { EphemeralClarificationWaiter } from '../ephemeral-clarification-waiter.js';

describe('ephemeral clarification lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the side chat own the wait deadline and cancellation', async () => {
    vi.useFakeTimers();
    const waiter = new EphemeralClarificationWaiter();
    const settled = vi.fn();
    const answer = waiter.start({ runId: 'run-1', publish: vi.fn(), request: { question: 'Continue?' } });
    const result = answer.then(settled, (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(settled).not.toHaveBeenCalled();
    waiter.cancelForRun('run-1');
    await expect(result).resolves.toContain('cancelled');
    waiter.dispose();
  });

  it('checks the owning lifecycle even when a generic response endpoint answers', async () => {
    const waiter = new EphemeralClarificationWaiter();
    const publish = vi.fn();
    let allowed = false;
    const answer = waiter.start({
      runId: 'run', request: { question: 'Allow this tool?', kind: 'approval' },
      publish, beforeResponse: () => allowed,
    });
    const requestId = publish.mock.calls[0][0].requestId as string;
    expect(waiter.answer(requestId, 'Allow once')).toBe(false);
    allowed = true;
    expect(waiter.answer(requestId, 'Deny')).toBe(true);
    await expect(answer).resolves.toBe('Deny');
    waiter.dispose();
  });
});
