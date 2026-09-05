import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: Record<string, unknown>) => void>(),
  start: vi.fn(async () => {}), stop: vi.fn(async () => {}), capture: vi.fn(),
  permission: vi.fn(async () => ({ granted: true })),
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({
  start: mocks.start, stop: mocks.stop, setCaptureEnabled: mocks.capture,
  addListener: (event: string, fn: (event: Record<string, unknown>) => void) => {
    mocks.listeners.set(event, fn);
    return { remove: () => mocks.listeners.delete(event) };
  },
}) }));
vi.mock('expo-audio', () => ({ requestRecordingPermissionsAsync: mocks.permission }));

import { NativeAudioSession } from '../native-audio-session';
import { isAudioCaptureActive } from '../audio-playback-coordinator';
const labels = { title: 'Call', end: 'End' };
const callbacks = () => ({ pcm: vi.fn(), played: vi.fn(), interrupted: vi.fn() });
afterEach(() => vi.clearAllMocks());

describe('native capture ownership', () => {
  it('discards bridge frames queued before mute or stop, including after unmute', async () => {
    const audio = new NativeAudioSession(); const events = callbacks();
    await audio.start(false, labels, events);
    audio.capture(true);
    const oldId = mocks.capture.mock.calls.at(-1)![1];
    audio.capture(false); audio.capture(true);
    const newId = mocks.capture.mock.calls.at(-1)![1];
    const pcm = mocks.listeners.get('pcm')!;
    pcm({ audio: 'AAA=', captureId: oldId });
    expect(events.pcm).not.toHaveBeenCalled();
    pcm({ audio: 'AAA=', captureId: newId });
    expect(events.pcm).toHaveBeenCalledOnce();
    await audio.stop();
    pcm({ audio: 'AAA=', captureId: newId });
    expect(events.pcm).toHaveBeenCalledOnce();
    expect(isAudioCaptureActive()).toBe(false);
  });
  it('does not open hardware when cancelled while permission is pending', async () => {
    let grant!: (value: { granted: boolean }) => void;
    mocks.permission.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const audio = new NativeAudioSession();
    const start = audio.start(false, labels, callbacks());
    await audio.stop(); grant({ granted: true });
    await expect(start).rejects.toThrow('CANCELLED');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(isAudioCaptureActive()).toBe(false);
  });
});
