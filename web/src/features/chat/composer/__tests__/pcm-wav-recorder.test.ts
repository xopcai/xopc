import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateRmsLevel,
  encodePcm16Wav,
  PcmFrameCapture,
  PcmStreamEncoder,
  resamplePcm,
} from '../pcm-wav-recorder';

function fakeCapture() {
  const context = {
    sampleRate: 48_000,
    close: vi.fn().mockResolvedValue(undefined),
  };
  const source = { disconnect: vi.fn() };
  const node: {
    port: { onmessage: null; postMessage: ReturnType<typeof vi.fn> };
    onprocessorerror: (() => void) | null;
    disconnect: ReturnType<typeof vi.fn>;
  } = {
    port: { onmessage: null, postMessage: vi.fn() },
    onprocessorerror: null,
    disconnect: vi.fn(),
  };
  const mutedOutput = { disconnect: vi.fn() };
  const capture = Reflect.construct(PcmFrameCapture, [
    context,
    source,
    node,
    mutedOutput,
    { onSamples: vi.fn() },
  ]) as PcmFrameCapture;
  return { capture, context, source, node, mutedOutput };
}

describe('PCM WAV recorder helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the PCM processor from a bundled same-origin URL', async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const mutedOutput = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    class FakeAudioContext {
      sampleRate = 48_000;
      audioWorklet = { addModule };
      destination = {};
      createMediaStreamSource = vi.fn(() => source);
      createGain = vi.fn(() => mutedOutput);
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    }
    class FakeAudioWorkletNode {
      port = { onmessage: null, postMessage: vi.fn() };
      onprocessorerror: (() => void) | null = null;
      connect = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);

    const stream = {} as MediaStream;
    const capture = await PcmFrameCapture.start(stream, { onSamples: vi.fn() });

    expect(addModule).toHaveBeenCalledOnce();
    const moduleUrl = addModule.mock.calls[0]?.[0];
    expect(moduleUrl).toEqual(expect.any(String));
    expect(moduleUrl).not.toMatch(/^(?:blob|data):/);
    capture.cancel();
    expect(close).toHaveBeenCalledOnce();
  });

  it('encodes mono samples as a valid 16 kHz PCM16 WAV file', () => {
    const encoded = encodePcm16Wav(new Float32Array([-1, 0, 1]));
    const view = new DataView(encoded);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(encoded, offset, length));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it('resamples PCM without requiring MediaRecorder or a codec binary', () => {
    const output = resamplePcm(new Float32Array([0, 0.5, 1, 0.5]), 8_000, 16_000);

    expect(output).toHaveLength(8);
    expect(output[0]).toBe(0);
    expect(output[2]).toBeCloseTo(0.5);
    expect(output[4]).toBeCloseTo(1);
  });

  it('keeps resampling continuous across microphone chunk boundaries', () => {
    const source = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(index / 19));
    const oneShot = new PcmStreamEncoder(48_000, 16_000);
    const chunked = new PcmStreamEncoder(48_000, 16_000);
    const expected = new Uint8Array(oneShot.push(source));
    const parts = [
      new Uint8Array(chunked.push(source.slice(0, 733))),
      new Uint8Array(chunked.push(source.slice(733, 2_017))),
      new Uint8Array(chunked.push(source.slice(2_017))),
    ];
    const actual = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      actual.set(part, offset);
      offset += part.length;
    }
    expect(actual).toEqual(expected);
  });

  it('calculates a stable normalized RMS level for local VAD', () => {
    expect(calculateRmsLevel(new Float32Array([]))).toBe(0);
    expect(calculateRmsLevel(new Float32Array([0, 0, 0]))).toBe(0);
    expect(calculateRmsLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(calculateRmsLevel(new Float32Array([2, -2]))).toBe(1);
  });

  it('stops and releases audio resources when the worklet does not acknowledge flush', async () => {
    vi.useFakeTimers();
    const { capture, context, source, node, mutedOutput } = fakeCapture();

    const stopped = capture.stop();
    expect(node.port.postMessage).toHaveBeenCalledWith('flush');
    await vi.advanceTimersByTimeAsync(1_000);
    await stopped;

    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(mutedOutput.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('does not wait for flush after the audio processor has failed', async () => {
    const { capture, context, node } = fakeCapture();
    expect(node.onprocessorerror).toBeTypeOf('function');
    node.onprocessorerror?.();

    await capture.stop();

    expect(node.port.postMessage).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

});
