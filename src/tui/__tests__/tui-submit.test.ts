import { describe, expect, it, vi } from 'vitest';

import { createEditorSubmitHandler, createSubmitBurstCoalescer, shouldEnableWindowsGitBashPasteFallback } from '../tui-submit.js';

describe('createEditorSubmitHandler', () => {
  it('steers instead of sending when the agent is busy', () => {
    const steerWhileBusy = vi.fn();
    const sendMessage = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand: vi.fn(),
      sendMessage,
      handleBangLine: vi.fn(),
      isAgentBusy: () => true,
      steerWhileBusy,
    });

    submit('change direction please');
    expect(steerWhileBusy).toHaveBeenCalledWith('change direction please');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('still sends slash commands while busy', () => {
    const handleCommand = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand,
      sendMessage: vi.fn(),
      handleBangLine: vi.fn(),
      isAgentBusy: () => true,
      steerWhileBusy: vi.fn(),
    });

    submit('/abort');
    expect(handleCommand).toHaveBeenCalledWith('/abort');
  });
});

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
