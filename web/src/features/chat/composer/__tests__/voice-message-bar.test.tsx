// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { VoiceMessageBar } from '../voice-message-bar';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: mocks.fetch }));

describe('voice message playback', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); });
    URL.createObjectURL = vi.fn(() => 'blob:voice');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it('pauses another voice message and both messages when recording starts', async () => {
    await act(async () => root.render(<><VoiceMessageBar att={{ content: 'YQ==', durationSeconds: 18 }} /><VoiceMessageBar att={{ content: 'Yg==', durationSeconds: 12 }} /></>));
    const audio = container.querySelectorAll('audio');
    await act(async () => { await audio[0].play(); });
    await act(async () => { await audio[1].play(); });
    expect(container.querySelectorAll('button[aria-label="Pause"]')).toHaveLength(1);
    act(() => window.dispatchEvent(new Event('xopc-voice-recording-start')));
    expect(container.querySelectorAll('button[aria-label="Pause"]')).toHaveLength(0);
  });

  it('retries failed downloads and releases the object URL on source replacement', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['a']) });
    await act(async () => root.render(<VoiceMessageBar att={{ uri: 'media://inbound/voice.wav' }} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Audio unavailable');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Retry playback"]')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('audio')?.src).toBe('blob:voice');
    await act(async () => root.render(<VoiceMessageBar att={{ content: 'Yg==' }} />));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
  });

  it('discards a stale download after the attachment is replaced', async () => {
    let finish!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(<VoiceMessageBar att={{ uri: 'media://inbound/old.wav' }} />));
    await act(async () => root.render(<VoiceMessageBar att={{ content: 'Yg==' }} />));
    await act(async () => finish({ ok: true, blob: async () => new Blob(['old']) }));
    expect(container.querySelector('audio')?.src).toContain('base64,Yg==');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('expands an available transcript without generating or exposing attachment data', async () => {
    await act(async () => root.render(<VoiceMessageBar att={{ content: 'YQ==', extractedText: 'Schedule the proposal for tomorrow.' }} />));
    expect(container.textContent).not.toContain('Schedule the proposal');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-controls$="-text"]')!.click());
    expect(container.textContent).toContain('Schedule the proposal for tomorrow.');
  });
  it('does not show an error when playback is deliberately interrupted', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Interrupted', 'AbortError'));
    await act(async () => root.render(<VoiceMessageBar att={{ content: 'YQ==' }} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Play voice"]')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

});
