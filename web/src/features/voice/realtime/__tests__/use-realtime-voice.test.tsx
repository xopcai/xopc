// @vitest-environment jsdom

import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { VoiceCallProvider } from '../voice-call-provider';
import { useVoiceCall, type VoiceCallContextValue } from '../voice-call-context';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessages } from '@/i18n/messages';

const mocks = vi.hoisted(() => ({
  refine: vi.fn(async (_url: string, options: RequestInit) => ({ payload: { text: JSON.parse(options.body as string).text } })),
  connect: vi.fn(),
  preflight: vi.fn(async () => {}),
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

vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.refine }));
vi.mock('@/features/voice/realtime/voice-session-client', () => ({
  VoiceSessionClient: { connect: mocks.connect, preflight: mocks.preflight },
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

import { useRealtimeVoice, type UseRealtimeVoiceReturn } from '../use-realtime-voice';

const chat = {
  ...messages('en').chat,
  voiceMicDenied: 'Microphone unavailable',
  voiceMicUnavailable: 'Microphone device unavailable',
  voiceRecorderFailed: 'Recorder failed',
  voiceSttNotConfigured: 'No streaming STT',
  voiceTranscribeFailed: 'Transcription failed',
  voiceTranscribeEmpty: 'No speech detected',
} satisfies ChatMessages;

describe('useRealtimeVoice', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let voice: UseRealtimeVoiceReturn;
  let onEvent: (event: any) => void;
  let onClose: (reason: string) => void;
  let onAudio: (audio: ArrayBuffer, responseId: string) => void;
  const sendAudio = vi.fn();
  const commit = vi.fn();
  const setInputMuted = vi.fn();
  const stop = vi.fn();
  const cancelResponse = vi.fn();
  const acknowledgeAudio = vi.fn();
  let onAudioLevel: (level: { level: number; speaking: boolean }) => void;
  let bargeIn = true;
  let onSamples: (samples: Float32Array) => void;
  const track = { enabled: true, stop: vi.fn() };
  const cancelCapture = vi.fn();
  const stopCapture = vi.fn(async () => undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.pendingAudio = false;
    bargeIn = true;
    track.enabled = true;
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
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
        setInputMuted,
        reportMetric: vi.fn(),
        commit,
        stop,
        cancelResponse,
        acknowledgeAudio,
      };
    });
    mocks.startCapture.mockImplementation(async (_stream, options) => {
      onAudioLevel = options.onAudioLevel;
      onSamples = options.onSamples;
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

  function render(onTranscript = vi.fn()) {
    function Harness() {
      voice = useRealtimeVoice({ disabled: false, chat, onTranscript });
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
    expect(onTranscript).not.toHaveBeenCalled();

    act(() => voice.confirmVoiceInput());
    await act(async () => Promise.resolve());
    expect(commit).toHaveBeenCalledOnce();
    await act(async () => onClose('input_committed'));
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('recognized text');
    expect(voice.phase).toBe('idle');
  });

  it('cancels recognized dictation without changing the draft', async () => {
    const onTranscript = render();
    await act(async () => voice.startVoiceInput());
    act(() => onEvent({ type: 'input.transcript.final', payload: { utteranceId: 'a', revision: 1, text: 'discard me' } }));
    act(() => voice.cancelVoiceInput());
    await act(async () => onClose('input_committed'));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it('recovers finalized text after disconnect and ignores refinement after cancellation', async () => {
    let finish!: (value: { payload: { text: string } }) => void;
    mocks.refine.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onTranscript = render();
    await act(async () => voice.startVoiceInput());
    act(() => onEvent({ type: 'input.transcript.final', payload: { utteranceId: 'a', revision: 1, text: 'keep me' } }));
    act(() => onClose('disconnected'));
    expect(voice.finalTranscript).toBe('keep me');
    act(() => voice.confirmVoiceInput());
    expect(mocks.refine).toHaveBeenCalled();
    act(() => voice.cancelVoiceInput());
    await act(async () => finish({ payload: { text: 'polished' } }));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('applies configured refinement once after all dictation finals', async () => {
    mocks.refine.mockResolvedValueOnce({ payload: { text: 'First. Second.' } });
    const onTranscript = render();
    await act(async () => voice.startVoiceInput());
    for (const id of ['first', 'second']) act(() => onEvent({ type: 'input.transcript.final', payload: { utteranceId: id, revision: 1, text: id } }));
    await act(async () => voice.confirmVoiceInput());
    await act(async () => { onClose('input_committed'); onClose('input_committed'); });
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('First. Second.');
    expect(mocks.refine).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ body: JSON.stringify({ text: 'first second' }) }));
  });

  it('does not commit a new capture when an old dictation stop finishes late', async () => {
    let finish!: () => void;
    stopCapture.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
    render();
    await act(async () => voice.startVoiceInput());
    act(() => voice.confirmVoiceInput());
    act(() => voice.cancelVoiceInput());
    await act(async () => voice.startVoiceInput());
    await act(async () => finish());
    expect(commit).not.toHaveBeenCalled();
    expect(voice.phase).toBe('recording');
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
      'No streaming STT',
      undefined,
      { href: '/settings/capabilities/voice' },
    );
  });

  it('streams assistant text and audio in conversation mode', async () => {
    render();
    await act(async () => voice.startVoiceConversation('agent:main:webchat:default:direct:voice', 'agent'));

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
    render();
    await act(async () => voice.startVoiceConversation('agent:main:webchat:default:direct:voice', 'omni'));
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
    render();
    await act(async () => voice.startVoiceConversation('agent:main:webchat:default:direct:voice', 'agent'));
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

  it('warns about discarded input while keeping the call and current playback active', async () => {
    await startResponse();
    act(() => onEvent({ type: 'session.error', payload: { code: 'INPUT_DROPPED', recoverable: true } }));
    expect(mocks.notify).toHaveBeenCalledWith('warning', messages('en').chat.voiceInputDropped);
    expect(mocks.playerClear).not.toHaveBeenCalled();
    expect(voice.responsePhase).toBe('speaking');
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
    expect(voice.phase).toBe('error');
  });
  it('mutes capture and upload without muting assistant playback', async () => {
    render();
    await act(async () => voice.startVoiceConversation('same-session', 'agent'));
    sendAudio.mockClear();
    act(() => voice.toggleMute());
    expect(track.enabled).toBe(false);
    expect(sendAudio).not.toHaveBeenCalled();
    expect(setInputMuted).toHaveBeenCalledWith(true);
    sendAudio.mockClear();
    act(() => onSamples(new Float32Array([0.8])));
    expect(sendAudio).not.toHaveBeenCalled();
    expect(mocks.playerSetMuted).not.toHaveBeenCalled();
    act(() => voice.toggleMute());
    expect(track.enabled).toBe(true);
    act(() => onSamples(new Float32Array([0.8])));
    expect(sendAudio).toHaveBeenCalledOnce();
  });

  it('reuses the same conversation key after ending and reconnecting', async () => {
    render();
    await act(async () => voice.startVoiceConversation('same-session', 'omni'));
    act(() => voice.cancelVoiceInput());
    await act(async () => voice.startVoiceConversation('same-session', 'omni'));
    expect(mocks.connect.mock.calls.map(([options]) => options.sessionKey)).toEqual(['same-session', 'same-session']);
  });

  it('ignores permission completion after the user ends a pending call', async () => {
    let resolve!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render();
    let pending!: Promise<void>;
    await act(async () => { pending = voice.startVoiceConversation('same-session', 'omni'); });
    act(() => voice.cancelVoiceInput());
    await act(async () => { resolve({ getTracks: () => [track] } as unknown as MediaStream); await pending; });
    expect(track.stop).toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(voice.phase).toBe('idle');
  });

  it('discards capture buffers when initialization completes after cancellation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.startCapture.mockImplementationOnce(async (_stream, options) => {
      options.onSamples(new Float32Array([0.8]));
      return new Promise((r) => { resolve = r; });
    });
    render();
    let pending!: Promise<void>;
    await act(async () => { pending = voice.startVoiceConversation('same-session', 'omni'); });
    act(() => voice.cancelVoiceInput());
    await act(async () => { resolve({ sampleRate: 48_000, cancel: cancelCapture }); await pending; });
    expect(sendAudio).not.toHaveBeenCalled();
    expect(cancelCapture).toHaveBeenCalled();
  });

  it('rejects unavailable capabilities before asking for the microphone', async () => {
    mocks.preflight.mockRejectedValueOnce(new Error('Natural voice requires sign-in'));
    render();
    await act(async () => voice.startVoiceConversation('same-session', 'omni'));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(voice.error).toBe('Natural voice requires sign-in');
  });

  it('keeps the global call alive after the initiating page unmounts and reconnects to the same chat', async () => {
    useLocaleStore.setState({ language: 'en' });
    const labels = messages('en').chat;
    let call!: VoiceCallContextValue;
    function Page() { call = useVoiceCall(); return <p>Chat page</p>; }
    function App({ showPage }: { showPage: boolean }) {
      return <MemoryRouter><VoiceCallProvider>{showPage ? <Page /> : <p>Another page</p>}</VoiceCallProvider></MemoryRouter>;
    }
    const click = async (label: string) => {
      const button = [...document.querySelectorAll('button')].find((element) => element.textContent === label || element.getAttribute('aria-label') === label);
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    act(() => root.render(<App showPage />));
    await act(async () => call.open({ sessionKey: 'same-session', name: 'Ada' }));
    expect(call.active).toBe(true);
    act(() => {
      onEvent({ type: 'response.created', payload: { responseId: 'reply' } });
      onEvent({ type: 'response.audio.started', payload: { responseId: 'reply' } });
    });
    await click(labels.voiceResponseInterrupt);
    expect(cancelResponse).toHaveBeenCalledExactlyOnceWith('reply');
    expect(commit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(track.enabled).toBe(true);
    expect(call.active).toBe(true);
    await click(labels.callMinimize);
    act(() => root.render(<App showPage={false} />));
    expect(stop).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(document.querySelector('[role="region"]')?.textContent).toContain('Ada');
    await act(async () => document.querySelector<HTMLButtonElement>('[role="region"] button')!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click(labels.callEnd);
    expect(stop).toHaveBeenCalledWith('user_finished');
    act(() => root.render(<App showPage />));
    await act(async () => call.open({ sessionKey: 'same-session', name: 'Ada' }));
    expect(mocks.connect.mock.calls.map(([options]) => options.sessionKey)).toEqual(['same-session', 'same-session']);
  });

  it('keeps muted native calls connected after a recoverable reply failure', async () => {
    render();
    await act(async () => voice.startVoiceConversation('same-session', 'omni'));
    act(() => voice.toggleMute());
    act(() => {
      onEvent({ type: 'response.created', payload: { responseId: 'slow' } });
      onEvent({ type: 'response.cancelled', payload: { responseId: 'slow', reason: 'client_cancelled' } });
      onEvent({ type: 'session.error', payload: { code: 'RESPONSE_FAILED', recoverable: true, message: 'Reply stopped' } });
    });
    expect(voice.phase).toBe('recording');
    expect(voice.error).toBeNull();
    expect(track.enabled).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    act(() => voice.toggleMute());
    act(() => onEvent({ type: 'response.created', payload: { responseId: 'next' } }));
    expect(voice.responsePhase).toBe('thinking');
  });

});
