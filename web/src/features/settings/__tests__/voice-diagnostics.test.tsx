// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), capture: vi.fn(), preview: vi.fn(), play: vi.fn(), close: vi.fn(),
}));
vi.mock('@/features/voice/realtime/voice-session-client', () => ({ VoiceSessionClient: { connect: mocks.connect } }));
vi.mock('@/features/chat/composer/pcm-wav-recorder', () => ({
  PcmFrameCapture: { start: mocks.capture },
  PcmStreamEncoder: class { push() { return new ArrayBuffer(2); } },
}));
vi.mock('@/features/voice/realtime/pcm-player', () => ({
  PcmPlayer: class { start = async () => {}; enqueue = mocks.play; close = mocks.close; },
}));
vi.mock('../voice-config-api', () => ({ previewRealtimeVoice: mocks.preview }));

import { VoiceDiagnostics } from '../voice-diagnostics';

describe('voice diagnostics lifecycle', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let unmounted: boolean;
  let onEvent: (event: { type: string; payload: { text: string } }) => void;
  const trackStop = vi.fn();
  const captureCancel = vi.fn();
  const clientStop = vi.fn();
  const v = messages('en').voiceSettings;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    unmounted = false;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })),
    } });
    mocks.connect.mockImplementation(async (options) => {
      onEvent = options.onEvent;
      return { session: { inputFormat: { sampleRate: 16000 } }, stop: clientStop, sendAudio: vi.fn() };
    });
    mocks.capture.mockResolvedValue({ sampleRate: 48000, cancel: captureCancel });
    mocks.preview.mockResolvedValue(new ArrayBuffer(4));
  });
  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount());
    container.remove();
  });
  async function render(canSpeak = true, disabled = false) {
    await act(async () => root.render(createElement(VoiceDiagnostics, { v, canListen: true, canSpeak, disabled })));
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  it('does not request a microphone or start playback on mount', async () => {
    await render();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('requires final transcription and heard confirmation before passing', async () => {
    await render();
    await click(v.setup.test);
    expect(container.textContent).toContain(v.setup.speakNow);
    await act(async () => onEvent({ type: 'input.transcript.final', payload: { text: 'Testing voice' } }));
    expect(trackStop).toHaveBeenCalled();
    expect(captureCancel).toHaveBeenCalled();
    expect(clientStop).toHaveBeenCalled();
    expect(container.textContent).not.toContain(v.setup.passed);
    await act(async () => mocks.play.mock.calls[0][1]());
    await click(v.setup.heard);
    expect(container.textContent).toContain(v.setup.passed);
    expect(container.textContent).toContain('Testing voice');
    expect(mocks.close).toHaveBeenCalled();
  });

  it('tests dictation without output or a chat session', async () => {
    await render(false);
    await click(v.setup.testInput);
    await act(async () => onEvent({ type: 'input.transcript.final', payload: { text: 'Hello' } }));
    expect(container.textContent).toContain(v.setup.inputPassed);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.connect.mock.calls[0][0]).not.toHaveProperty('sessionKey');
  });

  it('releases microphone permission granted after unmount', async () => {
    let grant!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    await render();
    await click(v.setup.test);
    await act(async () => root.unmount());
    unmounted = true;
    await act(async () => grant({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream));
    expect(trackStop).toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('does not play a late preview after cancellation', async () => {
    let resolvePreview!: (buffer: ArrayBuffer) => void;
    mocks.preview.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve; }));
    await render();
    await click(v.tts.test.play);
    await click(v.tts.test.stop);
    await act(async () => resolvePreview(new ArrayBuffer(4)));
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.preview.mock.calls[0][0].aborted).toBe(true);
  });

  it('disables tests while configuration is unsaved', async () => {
    await render(true, true);
    await click(v.setup.test);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});
