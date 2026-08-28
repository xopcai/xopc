import { describe, expect, it } from 'vitest';

import { PcmSegmentAccumulator } from '../live-pcm-segmenter';

const SAMPLE_RATE = 100;
const speech = (seconds: number) => new Float32Array(SAMPLE_RATE * seconds).fill(0.1);
const silence = (seconds: number) => new Float32Array(SAMPLE_RATE * seconds);

describe('PcmSegmentAccumulator', () => {
  it('emits after a speech pause instead of waiting for a fixed window', () => {
    const accumulator = new PcmSegmentAccumulator(SAMPLE_RATE);
    expect(accumulator.add(speech(4))).toEqual([]);
    const [segment] = accumulator.add(silence(1));
    expect(segment).toMatchObject({ sequence: 0, startedAtMs: 0, endedAtMs: 5_000 });
  });

  it('drops long silence without emitting empty STT work', () => {
    const accumulator = new PcmSegmentAccumulator(SAMPLE_RATE);
    expect(accumulator.add(silence(15))).toEqual([]);
    expect(accumulator.finish()).toEqual([]);
    expect(accumulator.lastSequence).toBe(-1);
  });

  it('bounds continuous speech and overlaps only max-length splits', () => {
    const accumulator = new PcmSegmentAccumulator(SAMPLE_RATE);
    const [first] = accumulator.add(speech(15));
    expect(first).toMatchObject({ sequence: 0, startedAtMs: 0, endedAtMs: 15_000 });

    accumulator.add(speech(1));
    const [last] = accumulator.finish();
    expect(last).toMatchObject({ sequence: 1, startedAtMs: 14_500, endedAtMs: 16_000 });
  });
});
