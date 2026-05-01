import { describe, expect, it, vi } from 'vitest';

import { createSubmitBurstCoalescer, shouldEnableWindowsGitBashPasteFallback } from '../tui-submit.js';

describe('createSubmitBurstCoalescer', () => {
  it('merges rapid single-line submits before flushing', () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const wrapped = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
      setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimer: clearTimeout,
    });

    wrapped('line1');
    wrapped('line2');
    vi.advanceTimersByTime(60);

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith('line1\nline2');
    vi.useRealTimers();
  });

  it('passes through immediately when disabled', () => {
    const submit = vi.fn();
    const wrapped = createSubmitBurstCoalescer({ submit, enabled: false });
    wrapped('a');
    expect(submit).toHaveBeenCalledWith('a');
  });
});

describe('shouldEnableWindowsGitBashPasteFallback', () => {
  it('enables on darwin + Apple Terminal', () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: 'darwin',
        env: { TERM_PROGRAM: 'Apple_Terminal' },
      }),
    ).toBe(true);
  });

  it('disables on linux by default', () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: 'linux',
        env: {},
      }),
    ).toBe(false);
  });
});
