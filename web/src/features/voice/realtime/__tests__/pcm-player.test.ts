import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PcmPlayer } from '../pcm-player';

function createSource() {
  return { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: ReturnType<typeof createSource>[] = [];
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: {
      cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(),
    } };
  }
  createBuffer(_channels: number, samples: number, rate: number) {
    return { duration: samples / rate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    const source = createSource();
    this.sources.push(source);
    return source;
  }
  async resume() {}
  async close() { this.state = 'closed'; }
}

describe('PcmPlayer', () => {
  let context: FakeAudioContext;
  beforeEach(() => {
    context = new FakeAudioContext();
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a fast audio burst and acknowledges only completed playback', () => {
    const player = new PcmPlayer();
    const played = vi.fn();
    for (let i = 0; i < 4; i += 1) player.enqueue(new ArrayBuffer(48_000), played);
    expect(context.sources).toHaveLength(4);
    expect(context.sources[3].start).toHaveBeenCalledWith(3.08);
    expect(played).not.toHaveBeenCalled();
    expect(player.hasPendingAudio).toBe(true);
    context.sources.forEach((source) => source.onended?.());
    expect(played).toHaveBeenCalledTimes(4);
    expect(player.hasPendingAudio).toBe(false);
  });

  it('does not acknowledge audio discarded by clear or close', async () => {
    const player = new PcmPlayer();
    const played = vi.fn();
    player.enqueue(new ArrayBuffer(48_000), played);
    const staleEnded = context.sources[0].onended;
    player.clear();
    staleEnded?.();
    expect(player.hasPendingAudio).toBe(false);
    expect(played).not.toHaveBeenCalled();
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    player.enqueue(new ArrayBuffer(48_000), played);
    await player.close();
    expect(context.state).toBe('closed');
    expect(played).not.toHaveBeenCalled();
  });
});
