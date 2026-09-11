import { describe, expect, it } from 'vitest';

import { PcmFrameBuffer } from '../pcmFrameBuffer.js';

describe('PcmFrameBuffer', () => {
  it('preserves samples across arbitrary provider chunks', () => {
    const source = Uint8Array.from({ length: 2_002 }, (_, index) => index % 251);
    const framer = new PcmFrameBuffer();
    const frames = [...framer.push(source.slice(0, 314)), ...framer.push(source.slice(314))];
    const tail = framer.finish();
    expect(frames.map(frame => frame.byteLength)).toEqual([960, 960]);
    expect(tail?.byteLength).toBe(960);
    const joined = new Uint8Array(2_880);
    [...frames, tail!].forEach((frame, index) => joined.set(frame, index * 960));
    expect(joined.slice(0, source.byteLength)).toEqual(source);
    expect(joined.slice(source.byteLength).every(byte => byte === 0)).toBe(true);
  });

  it('rejects incomplete PCM16 samples and does not emit an empty tail', () => {
    const framer = new PcmFrameBuffer();
    expect(() => framer.push(new Uint8Array(3))).toThrow('PCM16');
    expect(framer.finish()).toBeUndefined();
  });
});
