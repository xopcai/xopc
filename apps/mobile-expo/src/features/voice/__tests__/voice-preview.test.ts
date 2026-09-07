import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), mode: vi.fn(), write: vi.fn(), delete: vi.fn(),
  createPlayer: vi.fn(), play: vi.fn(), pause: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../../api/client', () => ({ apiFetch: mocks.fetch }));
vi.mock('expo-audio', () => ({ setAudioModeAsync: mocks.mode, createAudioPlayer: mocks.createPlayer }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    exists = true;
    uri = 'file:///cache/preview.wav';
    write = mocks.write;
    delete = mocks.delete;
  },
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));

import { VoicePreview } from '../voice-preview';

const requireReactNative = createRequire(import.meta.resolve('react-native/package.json'));
const { AbortController: NativeAbortController } = requireReactNative('abort-controller/dist/abort-controller');
const response = () => ({ ok: true, json: async () => ({ payload: { sampleRate: 24000, audio: 'AAA=' } }) });
let preview: VoicePreview;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('AbortController', NativeAbortController);
  mocks.fetch.mockResolvedValue(response());
  mocks.mode.mockResolvedValue(undefined);
  mocks.createPlayer.mockReturnValue({
    play: mocks.play, pause: mocks.pause, remove: mocks.remove, addListener: vi.fn(),
  });
  preview = new VoicePreview();
});
afterEach(() => {
  preview.stop();
  vi.unstubAllGlobals();
});

describe('voice preview with React Native AbortController', () => {
  it('plays a valid preview and releases the player and file', async () => {
    expect(new AbortController().signal.throwIfAborted).toBeUndefined();
    await preview.play();
    expect(mocks.mode).toHaveBeenCalledWith({ allowsRecording: false, playsInSilentMode: true });
    expect(mocks.write).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(mocks.play).toHaveBeenCalledOnce();
    preview.stop();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
  });

  it('does not initialize playback after stopping a pending request', async () => {
    let resolveResponse!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveResponse = resolve; }));
    const outcome = preview.play().then(() => undefined, error => error);
    preview.stop();
    resolveResponse(response());
    await expect(outcome).resolves.toMatchObject({ message: 'CANCELLED' });
    expect(mocks.mode).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.createPlayer).not.toHaveBeenCalled();
  });

  it('does not create a player after stopping pending audio initialization', async () => {
    let resolveMode!: () => void;
    mocks.mode.mockImplementationOnce(() => new Promise<void>(resolve => { resolveMode = resolve; }));
    const outcome = preview.play().then(() => undefined, error => error);
    await vi.waitFor(() => expect(mocks.mode).toHaveBeenCalledOnce());
    preview.stop();
    resolveMode();
    await expect(outcome).resolves.toMatchObject({ message: 'CANCELLED' });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.createPlayer).not.toHaveBeenCalled();
  });
});
