// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessages } from '@/i18n/messages';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  startCapture: vi.fn(),
  notify: vi.fn(),
  playerStart: vi.fn(async () => undefined),
  playerEnqueue: vi.fn(),
  playerClear: vi.fn(),
  playerDuck: vi.fn(),
  playerSetMuted: vi.fn(),
  playerClose: vi.fn(async () => undefined),
  pendingAudio: false,
}));

vi.mock('@/features/voice/realtime/voice-session-client', () => ({
  VoiceSessionClient: { connect: mocks.connect },
}));
vi.mock('@/features/chat/composer/composer-notifications', () => ({
  showComposerNotification: mocks.notify,
}));
vi.mock('@/features/voice/realtime/pcm-player', () => ({
  PcmPlayer: class {
    get hasPendingAudio() { return mocks.pendingAudio; }
    start = mocks.playerStart;
    enqueue = mocks.playerEnqueue;
    clear = mocks.playerClear;
    duck = mocks.playerDuck;
    setMuted = mocks.playerSetMuted;
    close = mocks.playerClose;
  },
}));
vi.mock('@/features/chat/composer/pcm-wav-recorder', () => ({
  PcmFrameCapture: { start: mocks.startCapture },
  PcmStreamEncoder: class {
    push() { return new ArrayBuffer(4); }
    flush() { return new ArrayBuffer(2); }
  },
}));

import { useComposerVoiceInput, type UseComposerVoiceInputReturn } from '../use-composer-voice-input';

const chat = {
  voiceMicDenied: 'Microphone unavailable',
  voiceMicUnavailable: 'Microphone device unavailable',
  voiceRecorderFailed: 'Recorder failed',
  voiceSttNotConfigured: 'STT unavailable',
  voiceTranscribeFailed: 'Transcription failed',
  voiceTranscribeEmpty: 'No speech detected',
} as ChatMessages;

describe('useComposerVoiceInput', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let voice: UseComposerVoiceInputReturn;
  let onEvent: (event: any) => void;
  let onClose: (reason: string) => void;
  let onAudio: (audio: ArrayBuffer, responseId: string) => void;
  const sendAudio = vi.fn();
  const commit = vi.fn();
  const stop = vi.fn();
  const cancelResponse = vi.fn();
  const acknowledgeAudio = vi.fn();
  let onAudioLevel: (level: { level: number; speaking: boolean }) => void;
  let bargeIn = true;
  const cancelCapture = vi.fn();
  const stopCapture = vi.fn(async () => undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.pendingAudio = false;
    bargeIn = true;
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    mocks.connect.mockImplementation(async (options) => {
      onEvent = options.onEvent;
      onClose = options.onClose;
      onAudio = options.onAudio;
      return {
        session: {
          inputMode: 'server_vad',
          get bargeIn() { return bargeIn; },
          inputFormat: { sampleRate: 16_000 },
          limits: { maxSessionMs: 600_000 },
        },
        sendAudio,
        commit,
        stop,
        cancelResponse,
        acknowledgeAudio,
      };
    });
    mocks.startCapture.mockImplementation(async (_stream, options) => {
      onAudioLevel = options.onAudioLevel;
      options.onSamples(new Float32Array([0, 0.25, -0.25]));
      return { sampleRate: 48_000, cancel: cancelCapture, stop: stopCapture };
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
  });

  function render(onTranscript = vi.fn(), sessionKey?: string) {
    function Harness() {
      voice = useComposerVoiceInput({ disabled: false, chat, onTranscript, sessionKey });
      return null;
    }
    act(() => root.render(<Harness />));
    return onTranscript;
  }

  it('streams microphone frames and applies final transcripts', async () => {
    const onTranscript = render();
    await act(async () => voice.startVoiceInput());
    expect(voice.phase).toBe('recording');
    expect(sendAudio).toHaveBeenCalled();

    act(() => onEvent({ type: 'input.transcript.delta', payload: { text: 'live' } }));
    expect(voice.partialTranscript).toBe('live');
    act(() => onEvent({ type: 'input.transcript.final', payload: { text: 'recognized text' } }));
    expect(onTranscript).toHaveBeenCalledWith('recognized text');

    act(() => voice.confirmVoiceInput());
    await act(async () => Promise.resolve());
    expect(commit).toHaveBeenCalledOnce();
    act(() => onClose('input_committed'));
    expect(voice.phase).toBe('idle');
  });

  it('stops without uploading a buffered recording', async () => {
    render();
    await act(async () => voice.startVoiceInput());
    act(() => voice.cancelVoiceInput());
    expect(cancelCapture).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith('user_finished');
    expect(voice.phase).toBe('idle');
  });

  it('reports session preflight failure before starting the recorder', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('No streaming STT'));
    render();
    await act(async () => voice.startVoiceInput());
    expect(mocks.startCapture).not.toHaveBeenCalled();
    expect(voice.phase).toBe('error');
    expect(mocks.notify).toHaveBeenCalledWith(
      'error',
      'STT unavailable',
      undefined,
      { href: '/settings/capabilities/voice' },
    );
  });

  it('streams assistant text and audio in conversation mode', async () => {
    render(vi.fn(), 'agent:main:webchat:default:direct:voice');
    await act(async () => voice.startVoiceConversation());

    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'conversation',
      sessionKey: 'agent:main:webchat:default:direct:voice',
    }));
    expect(mocks.playerStart).toHaveBeenCalledOnce();
    act(() => onEvent({ type: 'response.created', payload: { responseId: 'r1' } }));
    act(() => onEvent({ type: 'response.text.delta', payload: { responseId: 'r1', delta: '你好' } }));
    act(() => onAudio(new ArrayBuffer(4), 'r1'));
    expect(voice.responseText).toBe('你好');
    expect(mocks.playerEnqueue).toHaveBeenCalledOnce();
    mocks.playerClear.mockClear();
    act(() => onEvent({ type: 'input.speech_started', payload: { utteranceId: 'u1' } }));
    expect(mocks.playerClear).not.toHaveBeenCalled();
    act(() => onEvent({ type: 'response.cancelled', payload: { responseId: 'r1', reason: 'barge_in' } }));
    expect(mocks.playerClear).toHaveBeenCalledOnce();
  });

  it('selects Omni explicitly and ignores cancelled-response audio and text', async () => {
    render(vi.fn(), 'agent:main:webchat:default:direct:voice');
    await act(async () => voice.startVoiceConversation('omni'));
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'conversation', engine: 'omni' }));
    act(() => onEvent({ type: 'response.created', payload: { responseId: 'r1' } }));
    act(() => voice.interruptResponse());
    act(() => onEvent({ type: 'response.created', payload: { responseId: 'r2' } }));
    act(() => onAudio(new ArrayBuffer(4), 'r1'));
    act(() => onEvent({ type: 'response.text.delta', payload: { responseId: 'r1', delta: 'late' } }));
    expect(voice.responseText).toBe('');
    expect(mocks.playerEnqueue).not.toHaveBeenCalled();
    act(() => voice.cancelVoiceInput());
    act(() => onEvent({ type: 'response.created', payload: { responseId: 'r3' } }));
    expect(voice.phase).toBe('idle');
    expect(voice.responsePhase).toBe('idle');
  });

  async function startResponse() {
    render(vi.fn(), 'agent:main:webchat:default:direct:voice');
    await act(async () => voice.startVoiceConversation());
    act(() => {
      onEvent({ type: 'response.created', payload: { responseId: 'r1' } });
      onEvent({ type: 'response.audio.started', payload: { responseId: 'r1' } });
      onAudio(new ArrayBuffer(24_000), 'r1');
    });
    mocks.pendingAudio = true;
    mocks.playerClear.mockClear();
    return mocks.playerEnqueue.mock.calls.at(-1)![1] as () => void;
  }

  it('keeps playback interruptible after server completion until audio drains', async () => {
    const played = await startResponse();
    act(() => {
      onEvent({ type: 'response.audio.done', payload: { responseId: 'r1' } });
      onEvent({ type: 'response.done', payload: { responseId: 'r1' } });
    });
    expect(voice.responsePhase).toBe('speaking');
    expect(acknowledgeAudio).not.toHaveBeenCalled();
    mocks.pendingAudio = false;
    act(played);
    expect(acknowledgeAudio).toHaveBeenCalledWith('r1', 24_000);
    expect(voice.responsePhase).toBe('idle');
  });

  it('stops tail playback immediately and ignores late audio after manual interruption', async () => {
    const played = await startResponse();
    act(() => onEvent({ type: 'response.done', payload: { responseId: 'r1' } }));
    act(() => voice.interruptResponse());
    expect(mocks.playerClear).toHaveBeenCalledOnce();
    expect(cancelResponse).toHaveBeenCalledWith('r1');
    expect(voice.responsePhase).toBe('idle');
    act(() => { played(); onAudio(new ArrayBuffer(24_000), 'r1'); });
    expect(acknowledgeAudio).not.toHaveBeenCalled();
    expect(mocks.playerEnqueue).toHaveBeenCalledOnce();
  });

  it.each([true, false])('honors bargeIn=%s for ducking and waits for authoritative cancellation', async (enabled) => {
    await startResponse();
    bargeIn = enabled;
    act(() => {
      onAudioLevel({ level: 0.5, speaking: true });
      onEvent({ type: 'input.speech_started', payload: { utteranceId: 'u1' } });
    });
    expect(mocks.playerClear).not.toHaveBeenCalled();
    expect(mocks.playerDuck).toHaveBeenCalledTimes(enabled ? 1 : 0);
    act(() => voice.interruptResponse());
    expect(cancelResponse).toHaveBeenCalledWith('r1');
  });

  it('finishes a response whose audio drained before the completion event', async () => {
    const played = await startResponse();
    mocks.pendingAudio = false;
    act(played);
    act(() => onEvent({ type: 'response.done', payload: { responseId: 'r1' } }));
    expect(voice.responsePhase).toBe('idle');
  });

  it('stops capture when the realtime connection closes unexpectedly', async () => {
    render();
    await act(async () => voice.startVoiceInput());
    act(() => onClose('provider_error'));
    expect(cancelCapture).toHaveBeenCalled();
    expect(voice.phase).toBe('idle');
  });
});
