import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PcmPlayer, REALTIME_VOICE_OUTPUT_GAIN } from '../pcm-player';

function createSource() {
  return { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
}

interface FakeAudioParam {
  value: number;
  cancelScheduledValues?: ReturnType<typeof vi.fn>;
  setTargetAtTime?: ReturnType<typeof vi.fn>;
  setValueAtTime?: ReturnType<typeof vi.fn>;
}

interface FakeAudioNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface FakeGainNode extends FakeAudioNode {
  gain: FakeAudioParam & Required<Pick<FakeAudioParam, 'cancelScheduledValues' | 'setTargetAtTime' | 'setValueAtTime'>>;
}

interface FakeCompressorNode extends FakeAudioNode {
  threshold: FakeAudioParam;
  knee: FakeAudioParam;
  ratio: FakeAudioParam;
  attack: FakeAudioParam;
  release: FakeAudioParam;
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: ReturnType<typeof createSource>[] = [];
  gains: FakeGainNode[] = [];
  compressors: FakeCompressorNode[] = [];
  createGain(): FakeGainNode {
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: {
      value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(),
    } };
    this.gains.push(gain);
    return gain;
  }
  createDynamicsCompressor(): FakeCompressorNode {
    const compressor = {
      connect: vi.fn(), disconnect: vi.fn(),
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 },
    };
    this.compressors.push(compressor);
    return compressor;
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

  it('boosts conversation loudness through a peak limiter and preserves relative ducking', () => {
    const player = new PcmPlayer();
    const gain = context.gains[0];
    const limiter = context.compressors[0];
    expect(gain.gain.value).toBe(REALTIME_VOICE_OUTPUT_GAIN);
    expect(gain.connect).toHaveBeenCalledWith(limiter);
    expect(limiter.connect).toHaveBeenCalledWith(context.destination);
    expect(limiter.threshold.value).toBe(-6);
    player.duck(true);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      REALTIME_VOICE_OUTPUT_GAIN * 0.15,
      context.currentTime,
      0.015,
    );
    player.duck(false);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      REALTIME_VOICE_OUTPUT_GAIN,
      context.currentTime,
      0.015,
    );
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

  it('restarts quickly after a real queue underrun', () => {
    const player = new PcmPlayer();
    player.enqueue(new ArrayBuffer(48_000), vi.fn());
    context.sources[0].onended?.();
    context.currentTime = 1.5;
    player.enqueue(new ArrayBuffer(48_000), vi.fn());
    expect(context.sources[1].start).toHaveBeenCalledWith(1.515);
  });
});
