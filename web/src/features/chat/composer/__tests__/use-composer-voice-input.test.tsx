// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessages } from '@/i18n/messages';

const mocks = vi.hoisted(() => ({
  ready: false,
  fetchVoiceReadiness: vi.fn(),
  showComposerNotification: vi.fn(),
  startRecorder: vi.fn(),
  transcribeVoiceBlob: vi.fn(),
}));

vi.mock('@/features/chat/composer/voice-transcribe-api', () => ({
  fetchVoiceReadiness: mocks.fetchVoiceReadiness,
  transcribeVoiceBlob: mocks.transcribeVoiceBlob,
}));

vi.mock('@/features/chat/composer/composer-notifications', () => ({
  showComposerNotification: mocks.showComposerNotification,
}));

vi.mock('@/features/chat/composer/pcm-wav-recorder', () => ({
  PcmWavRecorder: { start: mocks.startRecorder },
}));

import {
  useComposerVoiceInput,
  type UseComposerVoiceInputReturn,
} from '@/features/chat/composer/use-composer-voice-input';

const chat = {
  voiceMicDenied: 'Microphone unavailable',
  voiceMicUnavailable: 'Microphone device unavailable',
  voiceRecorderFailed: 'Recorder failed',
  voicePreparationFailed: 'Local model is not ready',
  voiceTranscribeEmpty: 'No speech detected',
} as ChatMessages;

async function flushEffectsUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

describe('useComposerVoiceInput', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let voice: UseComposerVoiceInputReturn;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.ready = false;
    mocks.fetchVoiceReadiness.mockReset().mockImplementation(async () => (
      mocks.ready
        ? { state: 'ready', provider: 'xopc-local' }
        : { state: 'preparing', provider: 'xopc-local', modelId: 'sensevoice-small' }
    ));
    mocks.showComposerNotification.mockReset();
    mocks.startRecorder.mockReset();
    mocks.transcribeVoiceBlob.mockReset();
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: undefined,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it('skips the Electron permission request when microphone access is already granted', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'cloud' });
    const requestMicrophone = vi.fn();
    window.electronAPI = {
      platform: 'darwin',
      system: { requestMicrophone },
    } as unknown as NonNullable<Window['electronAPI']>;
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'granted' as const })) },
    });
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const cancel = vi.fn();
    mocks.startRecorder.mockResolvedValue({ cancel });

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });

    expect(requestMicrophone).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mocks.startRecorder).toHaveBeenCalledWith(stream, expect.any(Object));
    expect(voice.phase).toBe('recording');
  });

  it('places a successful gateway transcript in the draft and returns to the editor', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'cloud' });
    mocks.transcribeVoiceBlob.mockResolvedValue({
      text: 'recognized text',
      refinementAvailable: false,
    });
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    mocks.startRecorder.mockImplementation(async (_stream, options) => {
      options.onAudioLevel({ level: 0.05, speaking: true });
      options.onAudioLevel({ level: 0.05, speaking: true });
      return {
        cancel: vi.fn(),
        stop: vi.fn(async () => new Blob([new Uint8Array(64)], { type: 'audio/wav' })),
      };
    });
    const onTranscript = vi.fn();

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });
    act(() => voice.confirmVoiceInput());
    await flushEffectsUntil(() => voice.phase === 'idle');

    expect(mocks.transcribeVoiceBlob).toHaveBeenCalledWith(expect.any(Blob), 'audio/wav');
    expect(onTranscript).toHaveBeenCalledWith('recognized text');
    expect(voice.phase).toBe('idle');
    expect(voice.hasRetainedRecording).toBe(false);
  });

  it('does not upload a silent recording for transcription', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'cloud' });
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    mocks.startRecorder.mockResolvedValue({
      cancel: vi.fn(),
      stop: vi.fn(async () => new Blob([new Uint8Array(64)], { type: 'audio/wav' })),
    });

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });
    act(() => voice.confirmVoiceInput());
    await flushEffectsUntil(() => voice.phase === 'idle');

    expect(mocks.transcribeVoiceBlob).not.toHaveBeenCalled();
    expect(mocks.showComposerNotification).toHaveBeenCalledWith('warning', 'No speech detected');
    expect(voice.phase).toBe('idle');
  });

  it('reports recorder initialization failures separately from permission denial', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'xopc-local' });
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    mocks.startRecorder.mockRejectedValue(new DOMException(
      "Unable to load a worklet's module.",
      'AbortError',
    ));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(mocks.showComposerNotification).toHaveBeenCalledWith('error', 'Recorder failed');
    expect(mocks.showComposerNotification).not.toHaveBeenCalledWith('error', 'Microphone unavailable');
    expect(consoleError).toHaveBeenCalledWith(
      '[chat:voice] capture start failed',
      expect.objectContaining({ stage: 'recorder', kind: 'recorder', errorName: 'AbortError' }),
    );
    consoleError.mockRestore();
  });

  it('reports getUserMedia permission errors as permission denial', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'cloud' });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });

    expect(mocks.showComposerNotification).toHaveBeenCalledWith('error', 'Microphone unavailable');
    expect(consoleError).toHaveBeenCalledWith(
      '[chat:voice] capture start failed',
      expect.objectContaining({ stage: 'media', kind: 'permission', errorName: 'NotAllowedError' }),
    );
    consoleError.mockRestore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it('requests Electron microphone permission once after an in-progress model download and returns to idle when denied', async () => {
    let readinessCalls = 0;
    mocks.fetchVoiceReadiness.mockImplementation(async () => {
      readinessCalls += 1;
      return readinessCalls >= 3
        ? { state: 'ready', provider: 'xopc-local' }
        : { state: 'preparing', provider: 'xopc-local', modelId: 'sensevoice-small' };
    });
    const requestMicrophone = vi.fn(async () => ({
      status: 'denied' as const,
      outcome: 'denied' as const,
    }));
    window.electronAPI = {
      system: { requestMicrophone },
    } as unknown as NonNullable<Window['electronAPI']>;
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });
    await flushEffectsUntil(() => requestMicrophone.mock.calls.length > 0 && voice.phase === 'idle');

    expect(requestMicrophone).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.phase).toBe('idle');
    expect(mocks.showComposerNotification).toHaveBeenCalledTimes(1);
  });

  it('does not call getUserMedia while macOS reauthorization settings are open', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({ state: 'ready', provider: 'cloud' });
    const requestMicrophone = vi.fn(async () => ({
      status: 'unknown' as const,
      outcome: 'opened-settings' as const,
    }));
    window.electronAPI = {
      platform: 'darwin',
      system: { requestMicrophone },
    } as unknown as NonNullable<Window['electronAPI']>;
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });

    expect(requestMicrophone).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.phase).toBe('idle');
  });

  it('does not start a missing local model download when the microphone button is pressed', async () => {
    mocks.fetchVoiceReadiness.mockResolvedValue({
      state: 'needs_download',
      provider: 'xopc-local',
      modelId: 'sensevoice-small',
    });

    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript: vi.fn() });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await voice.startVoiceInput();
    });

    expect(voice.phase).toBe('idle');
    expect(mocks.showComposerNotification).toHaveBeenCalledWith(
      'error',
      'Local model is not ready',
      undefined,
      { href: '/settings/capabilities/voice' },
    );
  });
});
