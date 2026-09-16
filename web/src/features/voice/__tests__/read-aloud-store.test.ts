// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), pauseNote: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: mocks.fetch }));
vi.mock('@/features/notes/voice-player-store', () => ({ useVoicePlayerStore: { getState: () => ({ pause: mocks.pauseNote }) } }));
vi.mock('../read-aloud-text', () => ({ splitSpeakableText: (text: string) => text.split('|') }));

class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  duration = 10;
  playbackRate = 1;
  paused = true;
  readyState = 1;
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('play')); });
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute() { this.src = ''; }
  getAttribute() { return this.src; }
  metadata(duration = 10) { this.duration = duration; this.dispatchEvent(new Event('loadedmetadata')); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = () => ({ ok: true, blob: async () => new Blob(['audio']) });
const input = (id = 'first', text = 'one|two') => ({ source: { type: 'chat-message' as const, id, title: id }, text, language: 'en-US' as const });

// Import once so the singleton's window listeners have the same lifetime as its store.
import { useReadAloudStore } from '../read-aloud-store';

describe('read aloud playback lifecycle', () => {
  const audio = new FakeAudio();
  const store = () => useReadAloudStore.getState();
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('xopc:read-aloud-online-consent:v1', 'accepted');
    vi.stubGlobal('Audio', class { constructor() { return audio; } });
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    mocks.fetch.mockResolvedValue(response());
  });
  afterEach(() => { store().stop(); vi.unstubAllGlobals(); });
  async function start(value = input()) {
    store().requestStart(value);
    await vi.waitFor(() => expect(store().status).toBe('playing'));
  }
  // The store reuses one Audio element; keep its reference between tests.
  it('preserves a paused request and does not start when generation finishes', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    store().requestStart(input());
    store().pause();
    expect(store().source?.id).toBe('first');
    pending.resolve(response());
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(store().status).toBe('paused');
    expect(audio.play).not.toHaveBeenCalled();
    store().resume();
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    expect(mocks.fetch).toHaveBeenCalledTimes(2); // first chunk and one lookahead
  });

  it('does not revive stopped playback when a request finishes late', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    store().requestStart(input());
    store().stop();
    pending.resolve(response());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(store().status).toBe('idle');
    expect(store().source).toBeNull();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('announces resumed playback so other message players pause', async () => {
    const events = vi.fn();
    window.addEventListener('xopc-voice-playback-start', events);
    try {
      await start(input('single', 'one'));
      audio.metadata();
      audio.currentTime = 4;
      audio.dispatchEvent(new Event('timeupdate'));
      store().pause();
      store().resume();
      await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(2));
      expect(audio.currentTime).toBe(4);
    } finally { window.removeEventListener('xopc-voice-playback-start', events); }
  });

  it('replays the first chunk after a multi-chunk recording ends', async () => {
    await start();
    const firstUrl = audio.src;
    audio.metadata(10);
    expect(store().durationComplete).toBe(false);
    audio.dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(store().currentChunkIndex).toBe(1));
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    audio.metadata(20);
    expect(store().durationComplete).toBe(true);
    expect(store().duration).toBe(30);
    audio.pause(); // Native audio emits pause before ended.
    audio.dispatchEvent(new Event('ended'));
    expect(store().status).toBe('ended');
    store().resume();
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    expect(audio.src).toBe(firstUrl);
    expect(store().currentChunkIndex).toBe(0);
  });

  it('pauses a pending request when recording starts without discarding it', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    store().requestStart(input());
    window.dispatchEvent(new Event('xopc-voice-recording-start'));
    pending.resolve(response());
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(store().status).toBe('paused');
    expect(store().source).not.toBeNull();
  });
  it('seeks across cached chunks without resuming paused playback', async () => {
    await start();
    const firstUrl = audio.src;
    audio.metadata(10);
    store().seek(5);
    expect(store().currentChunkIndex).toBe(0); // Timeline is not complete yet.
    audio.dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(store().currentChunkIndex).toBe(1));
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    audio.metadata(20);
    store().pause();
    const playCount = audio.play.mock.calls.length;
    store().seek(4);
    await vi.waitFor(() => expect(store().status).toBe('paused'));
    expect(audio.src).toBe(firstUrl);
    audio.metadata(10);
    expect(audio.currentTime).toBe(4);
    expect(store().currentText).toBe('one');
    expect(audio.play).toHaveBeenCalledTimes(playCount);
    store().seek(25);
    await vi.waitFor(() => expect(store().status).toBe('paused'));
    audio.metadata(20);
    expect(audio.currentTime).toBe(15);
    expect(store().currentTime).toBe(25);
  });

  it('ignores a stale play promise after another source replaces it', async () => {
    const pending = deferred<void>();
    audio.play.mockImplementationOnce(() => pending.promise);
    store().requestStart(input('old', 'one'));
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    store().requestStart(input('new', 'replacement'));
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    pending.resolve();
    await Promise.resolve();
    expect(store().source?.id).toBe('new');
    expect(store().currentText).toBe('replacement');
  });

  it('fetches damaged audio again when retried', async () => {
    await start(input('single', 'one'));
    audio.dispatchEvent(new Event('error'));
    expect(store().status).toBe('error');
    store().resume();
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('replays from the beginning after seeking to the end', async () => {
    await start(input('single', 'one'));
    audio.metadata(10);
    store().seek(10);
    expect(store().status).toBe('ended');
    store().resume();
    await vi.waitFor(() => expect(store().status).toBe('playing'));
    expect(audio.currentTime).toBe(0);
  });

});
