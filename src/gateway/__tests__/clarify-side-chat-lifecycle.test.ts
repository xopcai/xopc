import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClarifyBridge } from '../clarify-bridge.js';

describe('externally managed clarification deadlines', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the side chat own the wait deadline and cancellation', async () => {
    vi.useFakeTimers();
    const bridge = new ClarifyBridge();
    const settled = vi.fn();
    const answer = bridge.startRequest({ sessionKey: 'side', runId: 'run-1', request: { question: 'Continue?' }, timeoutMs: null });
    const result = answer.then(settled, (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(settled).not.toHaveBeenCalled();
    bridge.cancelForRun('run-1');
    await expect(result).resolves.toContain('cancelled');
    bridge.dispose();
  });

  it('keeps the original timeout for ordinary conversations', async () => {
    vi.useFakeTimers();
    const bridge = new ClarifyBridge();
    const result = bridge.startRequest({ sessionKey: 'normal', request: { question: 'Continue?' } }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(result).resolves.toContain('within 5 minutes');
    bridge.dispose();
  });

  it('checks the owning lifecycle even when a generic response endpoint answers', async () => {
    const bridge = new ClarifyBridge();
    const publish = vi.fn();
    let allowed = false;
    const answer = bridge.startRequest({
      sessionKey: 'side', runId: 'run', request: { question: 'Allow this tool?', kind: 'approval' },
      publishStream: publish, timeoutMs: null, beforeResponse: () => allowed,
    });
    const requestId = publish.mock.calls[0][0].requestId as string;
    expect(bridge.handleResponse(requestId, 'Allow once')).toBe(false);
    allowed = true;
    expect(bridge.handleResponse(requestId, 'Deny')).toBe(true);
    await expect(answer).resolves.toBe('Deny');
    bridge.dispose();
  });
});
