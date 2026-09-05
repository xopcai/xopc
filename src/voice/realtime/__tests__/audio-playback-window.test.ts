import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudioPlaybackWindow } from '../audio-playback-window.js';

describe('AudioPlaybackWindow', () => {
  afterEach(() => vi.useRealTimers());

  it('backpressures fast synthesis until audio has actually played', async () => {
    const window = new AudioPlaybackWindow();
    const signal = new AbortController().signal;
    await window.reserve(96_000, signal);
    let resumed = false;
    const next = window.reserve(24_000, signal).then(() => { resumed = true; });
    await Promise.resolve();
    expect(resumed).toBe(false);
    window.acknowledge(24_000);
    await next;
    expect(resumed).toBe(true);
    const drained = window.drain(signal);
    window.acknowledge(120_000);
    await drained;
  });

  it('rejects future acknowledgements and ignores duplicates', async () => {
    const window = new AudioPlaybackWindow();
    await window.reserve(24_000, new AbortController().signal);
    expect(() => window.acknowledge(24_002)).toThrow('exceeds sent audio');
    window.acknowledge(24_000);
    window.acknowledge(0);
    window.acknowledge(24_000);
    await window.drain(new AbortController().signal);
  });

  it.each(['reserve', 'drain'] as const)('interrupts a pending %s immediately', async (method) => {
    const window = new AudioPlaybackWindow();
    const controller = new AbortController();
    await window.reserve(96_000, controller.signal);
    const pending = method === 'reserve' ? window.reserve(24_000, controller.signal) : window.drain(controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('times out stalled playback without leaking its wait timer', async () => {
    vi.useFakeTimers();
    const window = new AudioPlaybackWindow();
    await window.reserve(24_000, new AbortController().signal);
    const pending = expect(window.drain(new AbortController().signal)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
