import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: Record<string, unknown>) => void>(),
  start: vi.fn(async () => {}), stop: vi.fn(async () => {}), capture: vi.fn(),
  permission: vi.fn(async () => ({ granted: true })),
  getPermission: vi.fn(async () => ({ granted: true })),
  appState: { currentState: 'active' },
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({
  start: mocks.start, stop: mocks.stop, setCaptureEnabled: mocks.capture,
  addListener: (event: string, fn: (event: Record<string, unknown>) => void) => {
    mocks.listeners.set(event, fn);
    return { remove: () => mocks.listeners.delete(event) };
  },
}) }));
vi.mock('expo-audio', () => ({ getRecordingPermissionsAsync: mocks.getPermission, requestRecordingPermissionsAsync: mocks.permission }));
vi.mock('react-native', () => ({ AppState: mocks.appState }));

import { NativeAudioSession } from '../native-audio-session';
import { isAudioCaptureActive } from '../audio-playback-coordinator';
const labels = { title: 'Call', end: 'End' };
const callbacks = () => ({ pcm: vi.fn(), played: vi.fn(), interrupted: vi.fn() });
afterEach(() => { vi.clearAllMocks(); mocks.appState.currentState = 'active'; });

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
    mocks.getPermission.mockResolvedValueOnce({ granted: false });
    const audio = new NativeAudioSession();
    const start = audio.start(false, labels, callbacks());
    await vi.waitFor(() => expect(audio.permissionPromptActive).toBe(true));
    await audio.stop(); grant({ granted: true });
    await expect(start).rejects.toThrow('CANCELLED');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(isAudioCaptureActive()).toBe(false);
  });
  it('does not launch a permission activity when microphone access is already granted', async () => {
    const audio = new NativeAudioSession();
    await audio.start(false, labels, callbacks());
    expect(mocks.getPermission).toHaveBeenCalledOnce();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(audio.permissionPromptActive).toBe(false);
    await audio.stop();
  });
  it('tracks the first permission prompt until the app returns to the foreground', async () => {
    mocks.getPermission.mockResolvedValueOnce({ granted: false });
    const audio = new NativeAudioSession();
    mocks.permission.mockImplementationOnce(async () => {
      expect(audio.permissionPromptActive).toBe(true);
      mocks.appState.currentState = 'background';
      expect(mocks.start).not.toHaveBeenCalled();
      mocks.appState.currentState = 'active';
      return { granted: true };
    });
    await audio.start(false, labels, callbacks());
    expect(audio.permissionPromptActive).toBe(false);
    expect(mocks.start).toHaveBeenCalledOnce();
    await audio.stop();
  });
  it('does not start foreground-only capture if the user leaves during permission approval', async () => {
    mocks.getPermission.mockResolvedValueOnce({ granted: false });
    mocks.permission.mockImplementationOnce(async () => {
      mocks.appState.currentState = 'background';
      return { granted: true };
    });
    const audio = new NativeAudioSession();
    await expect(audio.start(false, labels, callbacks())).rejects.toThrow('background');
    expect(audio.permissionPromptActive).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(isAudioCaptureActive()).toBe(false);
  });
});
