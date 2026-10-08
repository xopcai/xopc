import { describe, expect, it, vi } from 'vitest';

vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: {}, common: {}, wantAgent: {} }));
vi.mock('@kit.BasicServicesKit', () => ({ systemDateTime: { TimeType: { STARTUP: 1 }, getUptime: () => 1000 } }));
vi.mock('@kit.AudioKit', () => ({ audio: {} }));
vi.mock('@kit.AVSessionKit', () => ({ avSession: {} }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));

import { XopcVoiceCallAudio } from '../entry/src/main/ets/service/voiceCallAudio.ets';

describe('Harmony voice playback acknowledgement', () => {
  it('ignores a rejected write from playback that the user has flushed', async () => {
    let rejectWrite!: (error: Error) => void;
    const renderer = {
      getAudioTimestampInfoSync: () => ({ framePos: 0, timestamp: 0 }),
      write: vi.fn(() => new Promise<number>((_resolve, reject) => { rejectWrite = reject; })),
      flush: vi.fn(async () => {}), stop: vi.fn(async () => {}), release: vi.fn(async () => {}), off: vi.fn(),
    };
    const onFailure = vi.fn();
    const call = new XopcVoiceCallAudio();
    const state = call as unknown as { renderer: typeof renderer; generation: number; callbacks: object };
    state.renderer = renderer; state.generation = 1;
    state.callbacks = { onInput: vi.fn(), onBuffered: vi.fn(), onPlayed: vi.fn(), onRoute: vi.fn(), onFailure };
    call.enqueue('response-1', new Uint8Array(960));
    await vi.waitFor(() => expect(renderer.write).toHaveBeenCalledOnce());
    const flushed = call.flush();
    rejectWrite(new Error('Write interrupted by flush'));
    await flushed;
    expect(onFailure).not.toHaveBeenCalled();
    await call.stop();
  });

  it('acknowledges renderer writes and waits for drain when the playback timestamp stalls', async () => {
    let finishDrain!: () => void;
    const drain = vi.fn(() => new Promise<void>((resolve) => { finishDrain = resolve; }));
    const renderer = {
      getAudioTimestampInfoSync: () => ({ framePos: 0, timestamp: 0 }),
      write: vi.fn(async (bytes: ArrayBuffer) => bytes.byteLength),
      drain, stop: vi.fn(async () => {}), release: vi.fn(async () => {}), off: vi.fn(),
    };
    const onBuffered = vi.fn();
    const onPlayed = vi.fn();
    const onFailure = vi.fn();
    const call = new XopcVoiceCallAudio();
    const state = call as unknown as { renderer: typeof renderer; generation: number; callbacks: object };
    state.renderer = renderer;
    state.generation = 1;
    state.callbacks = { onInput: vi.fn(), onBuffered, onPlayed, onRoute: vi.fn(), onFailure };

    call.enqueue('response-1', new Uint8Array(960));
    await vi.waitFor(() => expect(onBuffered).toHaveBeenCalledWith('response-1', 20));
    expect(onPlayed).not.toHaveBeenCalled();

    call.finish('response-1');
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
    expect(onPlayed).not.toHaveBeenCalled();
    finishDrain();
    await vi.waitFor(() => expect(onPlayed).toHaveBeenCalledWith('response-1', 20, 'drain'));
    expect(onFailure).not.toHaveBeenCalled();
    await call.stop();
  });

  it('flushes promptly when playback drain is still waiting', async () => {
    let finishDrain!: () => void;
    const drain = vi.fn(() => new Promise<void>((resolve) => { finishDrain = resolve; }));
    const flush = vi.fn(async () => {});
    const renderer = {
      getAudioTimestampInfoSync: () => ({ framePos: 0, timestamp: 0 }),
      write: vi.fn(async (bytes: ArrayBuffer) => bytes.byteLength),
      drain, flush, stop: vi.fn(async () => {}), release: vi.fn(async () => {}), off: vi.fn(),
    };
    const onPlayed = vi.fn();
    const call = new XopcVoiceCallAudio();
    const state = call as unknown as { renderer: typeof renderer; generation: number; callbacks: object };
    state.renderer = renderer;
    state.generation = 1;
    state.callbacks = { onInput: vi.fn(), onBuffered: vi.fn(), onPlayed, onRoute: vi.fn(), onFailure: vi.fn() };

    call.enqueue('response-1', new Uint8Array(960));
    call.finish('response-1');
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
    await call.flush();
    expect(flush).toHaveBeenCalledOnce();
    finishDrain();
    await Promise.resolve();
    expect(onPlayed).not.toHaveBeenCalled();
    await call.stop();
  });
  it('ramps down once and restores the original renderer volume', () => {
    const renderer = { getVolume: vi.fn(() => 0.8), setVolumeWithRamp: vi.fn() };
    const call = new XopcVoiceCallAudio(); (call as any).renderer = renderer;
    call.duck(true); call.duck(true); call.duck(false); call.duck(false);
    expect(renderer.getVolume).toHaveBeenCalledOnce();
    expect(renderer.setVolumeWithRamp.mock.calls).toEqual([[0.2, 60], [0.8, 120]]);
  });

});
