import { describe, expect, it, vi } from 'vitest';

import {
  createBackspaceDeduper,
  drainAndStopTuiSafely,
  resolveCtrlCAction,
  stopTuiSafely,
} from '../tui-lifecycle.js';

describe('createBackspaceDeduper', () => {
  function createTimedDedupe(start = 1000) {
    let now = start;
    const dedupe = createBackspaceDeduper({
      dedupeWindowMs: 8,
      now: () => now,
    });
    return {
      dedupe,
      advance: (deltaMs: number) => {
        now += deltaMs;
      },
    };
  }

  it('suppresses duplicate backspace events within the dedupe window', () => {
    const { dedupe, advance } = createTimedDedupe();

    expect(dedupe('\x7f')).toBe('\x7f');
    advance(1);
    expect(dedupe('\x08')).toBe('');
  });

  it('preserves backspace events outside the dedupe window', () => {
    const { dedupe, advance } = createTimedDedupe();

    expect(dedupe('\x7f')).toBe('\x7f');
    advance(10);
    expect(dedupe('\x7f')).toBe('\x7f');
  });

  it('never suppresses non-backspace keys', () => {
    const dedupe = createBackspaceDeduper();
    expect(dedupe('a')).toBe('a');
    expect(dedupe('\x1b[A')).toBe('\x1b[A');
  });
});

describe('resolveCtrlCAction', () => {
  it('clears input on first ctrl+c when editor has text', () => {
    expect(resolveCtrlCAction({ hasInput: true, now: 2000, lastCtrlCAt: 0 })).toEqual({
      action: 'clear',
      nextLastCtrlCAt: 2000,
    });
  });

  it('exits on second ctrl+c within the exit window', () => {
    expect(resolveCtrlCAction({ hasInput: false, now: 2800, lastCtrlCAt: 2000 })).toEqual({
      action: 'exit',
      nextLastCtrlCAt: 2000,
    });
  });

  it('shows warning when exit window has elapsed', () => {
    expect(resolveCtrlCAction({ hasInput: false, now: 3501, lastCtrlCAt: 2000 })).toEqual({
      action: 'warn',
      nextLastCtrlCAt: 3501,
    });
  });
});

describe('drainAndStopTuiSafely', () => {
  it('drains terminal input before stopping the TUI', async () => {
    const calls: string[] = [];
    const drainInput = vi.fn(async () => {
      calls.push('drain');
    });
    const stop = vi.fn(() => {
      calls.push('stop');
    });

    await drainAndStopTuiSafely({
      stop,
      terminal: { drainInput },
    });

    expect(drainInput).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(calls).toEqual(['drain', 'stop']);
  });

  it('still stops when the terminal does not support drainInput', async () => {
    const stop = vi.fn();

    await drainAndStopTuiSafely({
      stop,
      terminal: {},
    });

    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('stopTuiSafely', () => {
  it('swallows ignorable setRawMode EBADF errors', () => {
    const stop = vi.fn(() => {
      const err = new Error('read EINVAL');
      Object.assign(err, { code: 'EBADF', syscall: 'setRawMode' });
      throw err;
    });
    expect(() => stopTuiSafely(stop)).not.toThrow();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('rethrows other errors', () => {
    const stop = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() => stopTuiSafely(stop)).toThrow('boom');
  });
});
