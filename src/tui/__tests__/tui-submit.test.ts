import { describe, expect, it, vi } from 'vitest';

import { createEditorSubmitHandler, createSubmitBurstCoalescer, shouldEnableWindowsGitBashPasteFallback } from '../tui-submit.js';
import { drainFollowUpQueue, restoreQueuedMessages } from '../tui-follow-up-queue.js';

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

describe('drainFollowUpQueue', () => {
  it('drains one message in one-at-a-time mode', () => {
    const queue = ['first', 'second'];
    expect(drainFollowUpQueue(queue, 'one-at-a-time')).toBe('first');
    expect(queue).toEqual(['second']);
  });

  it('drains all messages as one prompt in all mode', () => {
    const queue = ['first', 'second'];
    expect(drainFollowUpQueue(queue, 'all')).toBe('first\n\nsecond');
    expect(queue).toEqual([]);
  });
});

describe('restoreQueuedMessages', () => {
  it('restores steering and follow-up queues before current editor text', () => {
    const steeringQueue = ['steer'];
    const followUpQueue = ['follow'];

    expect(
      restoreQueuedMessages(
        { steeringQueue, followUpQueue },
        'current draft',
      ),
    ).toEqual({
      text: 'steer\n\nfollow\n\ncurrent draft',
      restoredCount: 2,
    });
    expect(steeringQueue).toEqual([]);
    expect(followUpQueue).toEqual([]);
  });

  it('returns zero without changing blank current text when queues are empty', () => {
    expect(
      restoreQueuedMessages(
        { steeringQueue: [], followUpQueue: [] },
        '   ',
      ),
    ).toEqual({ text: '', restoredCount: 0 });
  });
});
