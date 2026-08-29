// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessages } from '@/i18n/messages';

const mocks = vi.hoisted(() => ({
  ready: false,
  fetchVoiceReadiness: vi.fn(),
  showComposerNotification: vi.fn(),
}));

vi.mock('@/features/chat/composer/voice-transcribe-api', () => ({
  fetchVoiceReadiness: mocks.fetchVoiceReadiness,
  transcribeVoiceBlob: vi.fn(),
}));

vi.mock('@/features/chat/composer/composer-notifications', () => ({
  showComposerNotification: mocks.showComposerNotification,
}));

vi.mock('@/features/chat/composer/pcm-wav-recorder', () => ({
  PcmWavRecorder: { start: vi.fn() },
}));

import {
  useComposerVoiceInput,
  type UseComposerVoiceInputReturn,
} from '@/features/chat/composer/use-composer-voice-input';

const chat = {
  voiceMicDenied: 'Microphone unavailable',
  voicePreparationFailed: 'Local model is not ready',
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
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
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
