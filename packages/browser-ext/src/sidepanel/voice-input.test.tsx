// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gatewayFetch: vi.fn(), getUserMedia: vi.fn(), start: vi.fn(), cancel: vi.fn(), stop: vi.fn() }));
vi.mock('./auth', () => ({ gatewayFetch: mocks.gatewayFetch }));
vi.mock('@xopcai/composer-core/pcm-wav-recorder', () => ({ PcmWavRecorder: { start: mocks.start } }));
import { MicrophonePermission } from './microphone-permission';
import { VoiceInput } from './voice-input';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onTranscript = vi.fn();
const onBusy = vi.fn();
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(button => button.textContent === text || button.getAttribute('aria-label') === text)!; }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(mocks).forEach(mock => mock.mockReset()); onTranscript.mockReset(); onBusy.mockReset();
  mocks.gatewayFetch.mockResolvedValue({ ok: true, json: async () => ({ voice: { sttAvailable: true } }) });
  mocks.start.mockResolvedValue({ cancel: mocks.cancel, stop: mocks.stop });
  mocks.stop.mockResolvedValue(new Blob(['audio'], { type: 'audio/wav' }));
  vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => key }, tabs: { create: vi.fn().mockResolvedValue({}) }, runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: mocks.getUserMedia }, configurable: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<VoiceInput disabled={false} onTranscript={onTranscript} onBusy={onBusy} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('voice input lifecycle', () => {
  it('offers an extension authorization tab after permission denial', async () => {
    mocks.getUserMedia.mockRejectedValue(new DOMException('Permission dismissed', 'NotAllowedError'));
    await act(async () => button('voiceInput').click());
    expect(container.textContent).toContain('voicePermissionHelp');
    await act(async () => button('voicePermissionOpen').click());
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/dist/sidepanel.html?microphone-permission' });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('requests permission only on click and immediately releases the microphone', async () => {
    const stop = vi.fn();
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    await act(async () => root.render(<MicrophonePermission />));
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    await act(async () => button('voicePermissionOpen').click());
    expect(stop).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('voicePermissionGranted');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('closes a microphone permission result that arrives after cancellation', async () => {
    let resolve!: (stream: unknown) => void;
    const stop = vi.fn();
    mocks.getUserMedia.mockImplementation(() => new Promise(done => { resolve = done; }));
    await act(async () => button('voiceInput').click());
    await act(async () => button('cancelQueuedMessage').click());
    await act(async () => resolve({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });
  it('stops recording tracks on unmount', async () => {
    const stop = vi.fn();
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    await act(async () => button('voiceInput').click());
    await act(async () => root.render(null));
    expect(mocks.cancel).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });
  it('does not request the microphone when recognition is unavailable', async () => {
    mocks.gatewayFetch.mockResolvedValue({ ok: true, json: async () => ({ voice: { sttAvailable: false } }) });
    await act(async () => button('voiceInput').click());
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    expect(container.textContent).toContain('voiceUnavailable');
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });
  it('puts the transcription into the draft and releases the microphone', async () => {
    const stop = vi.fn();
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    mocks.gatewayFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ voice: { sttAvailable: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payload: { text: 'hello world' } }) });
    await act(async () => button('voiceInput').click());
    await act(async () => button('voiceFinish').click());
    expect(onTranscript).toHaveBeenCalledWith('hello world');
    expect(stop).toHaveBeenCalled();
    expect(mocks.gatewayFetch.mock.calls[1][0]).toBe('/api/voice/transcriptions');
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

});
