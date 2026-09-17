import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { create: vi.fn(), open: vi.fn(), close: vi.fn() };
});
vi.mock('@kit.MediaKit', () => ({ media: { createAVPlayer: mocks.create } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { open: mocks.open, close: mocks.close, OpenMode: { READ_ONLY: 0 } } }));
import { XopcChatMediaPlayback } from '../entry/src/main/ets/service/chatMediaPlayback.ets';

function playerFixture() {
  const listeners = new Map<string, (value: never) => void>();
  return { duration: 8000, fdSrc: undefined, prepare: vi.fn().mockResolvedValue(undefined), play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined),
    on: (name: string, callback: (value: never) => void) => listeners.set(name, callback),
    emit: (name: string, value: unknown) => listeners.get(name)?.(value as never) };
}

describe('chat attachment audio lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.open.mockResolvedValue({ fd: 7 }); });
  it('prepares without autoplay, reflects native progress and toggles playback', async () => {
    const native = playerFixture(); mocks.create.mockResolvedValue(native);
    const audio = new XopcChatMediaPlayback(); await audio.open('/cache/owned.audio', 123);
    expect(native.fdSrc).toEqual({ fd: 7, offset: 0, length: 123 });
    native.emit('stateChange', 'initialized'); expect(native.prepare).toHaveBeenCalledOnce();
    native.emit('stateChange', 'prepared'); expect(audio.duration).toBe(8); expect(native.play).not.toHaveBeenCalled();
    await audio.toggle(); expect(native.play).toHaveBeenCalledOnce();
    native.emit('stateChange', 'playing'); native.emit('timeUpdate', 1600); expect(audio.position).toBe(1.6);
    await audio.toggle(); expect(native.pause).toHaveBeenCalledOnce();
    await audio.stop(); expect(native.release).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledWith({ fd: 7 });
    native.emit('timeUpdate', 7000); expect(audio.position).toBe(0); expect(audio.state).toBe('idle');
  });
  it('disposes a player that finishes creation after its preview closes', async () => {
    let finish!: (value: ReturnType<typeof playerFixture>) => void;
    mocks.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const audio = new XopcChatMediaPlayback(); const opening = audio.open('/cache/owned.audio', 123);
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    await audio.stop(); const native = playerFixture(); finish(native); await opening;
    expect(native.release).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce(); expect(native.fdSrc).toBeUndefined();
  });
  it('releases resources on native errors and ignores callbacks from a replaced player', async () => {
    const old = playerFixture(); const latest = playerFixture(); mocks.create.mockResolvedValueOnce(old).mockResolvedValueOnce(latest);
    const audio = new XopcChatMediaPlayback(); await audio.open('/cache/first.audio', 123); await audio.open('/cache/second.audio', 456);
    old.emit('error', new Error('STALE')); expect(audio.error).toBe(''); expect(audio.state).toBe('loading');
    latest.emit('error', new Error('UNSUPPORTED')); await Promise.resolve();
    expect(audio.error).toBe('UNSUPPORTED'); expect(audio.state).toBe('error'); expect(latest.release).toHaveBeenCalledOnce();
  });
});
