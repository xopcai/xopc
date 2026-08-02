import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTrialExpiryReconciler } from '../trial-expiry-reconciler.js';

describe('focus trial expiry reconciler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconciles at startup and throughout the gateway lifetime', async () => {
    vi.useFakeTimers();
    const reconcileExpiredTrials = vi.fn().mockResolvedValue(0);

    const stop = startTrialExpiryReconciler({ reconcileExpiredTrials }, 1_000);
    await vi.waitFor(() => expect(reconcileExpiredTrials).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(reconcileExpiredTrials).toHaveBeenCalledTimes(4);

    await stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reconcileExpiredTrials).toHaveBeenCalledTimes(4);
  });

  it('does not overlap slow reconciliation calls', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const reconcileExpiredTrials = vi.fn(() => new Promise<number>((resolve) => {
      finish = () => resolve(0);
    }));

    const stop = startTrialExpiryReconciler({ reconcileExpiredTrials }, 1_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reconcileExpiredTrials).toHaveBeenCalledTimes(1);

    finish?.();
    await vi.runAllTicks();
    await stop();
  });
});
