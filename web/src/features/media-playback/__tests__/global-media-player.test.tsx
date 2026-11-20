// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicPlayer } from '@/features/chat/music/music-player';
import { useVoicePlayerStore } from '@/features/notes/voice-player-store';
import { useLocaleStore } from '@/stores/locale-store';

import { GeneratedVideo } from '../generated-video';
import { useGeneratedMediaStore } from '../generated-media';
import { GlobalMediaPlayer } from '../global-media-player';

const noteMedia = vi.hoisted(() => ({ acquireNoteMediaObjectUrl: vi.fn(), releaseNoteMediaObjectUrl: vi.fn() }));
vi.mock('@/features/notes/note-media-blob', () => noteMedia);

describe('global media playback', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  const mini = () => document.querySelector('[aria-label="Floating media player"]');

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    const playing = new WeakSet<HTMLMediaElement>();
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return !playing.has(this); });
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(30);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      playing.add(this);
      this.dispatchEvent(new Event('play'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      playing.delete(this);
      this.dispatchEvent(new Event('pause'));
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

  function render(chat: boolean) {
    act(() => root.render(<>
      {chat ? <>
        <MusicPlayer src="/one.mp3" title="Track one" durationMs={30_000} language="en" lyricsOpen={false} onToggleLyrics={() => {}} />
        <MusicPlayer src="/two.mp3" title="Track two" durationMs={30_000} language="en" lyricsOpen={false} onToggleLyrics={() => {}} />
        <GeneratedVideo src="/video.mp4" title="Video" />
      </> : <audio src="/preview.wav" controls />}
      <GlobalMediaPlayer />
    </>));
  }

  it('closes previous music on playback changes and hands off to native media previews', async () => {
    render(true);
    const [first, second] = container.querySelectorAll('audio');
    const [playFirst, playSecond] = container.querySelectorAll<HTMLButtonElement>('[aria-label="Play"]');
    await act(async () => playFirst.click());
    first.currentTime = 12;
    await act(async () => playSecond.click());
    expect(first.paused).toBe(true);
    expect(first.currentTime).toBe(0);
    expect(second.paused).toBe(false);

    render(false);
    expect(mini()?.textContent).toContain('Track two');
    expect(second.paused).toBe(false);
    await act(async () => container.querySelector('audio')!.play());
    expect(second.paused).toBe(true);
    expect(mini()).toBeNull();
  });

  it('moves the same video to the floating window and back, and closes it on dismissal', async () => {
    render(true);
    const video = container.querySelector('video')!;
    await act(async () => video.play());
    video.currentTime = 14;
    expect(mini()).toBeNull();

    render(false);
    expect(mini()?.querySelector('video')).toBe(video);
    expect(mini()?.querySelector('[aria-label="Minimize player"]')).toBeNull();
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(14);
    render(true);
    expect(container.querySelector('video')).toBe(video);
    expect(mini()).toBeNull();

    render(false);
    act(() => mini()?.querySelector<HTMLButtonElement>('[aria-label="Close player"]')?.click());
    expect(mini()).toBeNull();
    expect(video.paused).toBe(true);
    expect(video.isConnected).toBe(false);
    expect(useGeneratedMediaStore.getState().active).toBeNull();
  });

  it('minimizes playing music to the upper right and lets the user move and reopen it', async () => {
    vi.useFakeTimers();
    render(true);
    const audio = container.querySelector('audio')!;
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    audio.currentTime = 12;
    render(false);

    const player = mini() as HTMLElement;
    const button = (label: string) => player.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const details = player.querySelector<HTMLInputElement>('input[type="range"]')!.parentElement!;
    expect(details.hidden).toBe(false);

    act(() => vi.advanceTimersByTime(4_000));
    act(() => button('Pause').click());
    act(() => vi.advanceTimersByTime(5_000));
    expect(details.hidden).toBe(false);
    await act(async () => button('Play').click());
    act(() => vi.advanceTimersByTime(5_000));

    expect(details.hidden).toBe(true);
    expect(player.style.right).toBe('12px');
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(12);

    const move = button('Move player');
    vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 80, 256, 56));
    const pointer = (type: string, x: number, y: number) => {
      move.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), {
        pointerId: 1, isPrimary: true, pointerType: 'touch',
      }));
    };
    act(() => {
      pointer('pointerdown', 720, 100);
      pointer('pointermove', 520, 200);
      pointer('pointerup', 520, 200);
      move.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(player.style.left).toBe('500px');
    expect(player.style.top).toBe('180px');

    act(() => button('Expand player').click());
    act(() => vi.advanceTimersByTime(5_000));
    expect(details.hidden).toBe(false);
    expect(player.style.left).toBe('500px');
    expect(audio.currentTime).toBe(12);
  });

  it('discards a pending note audio load after the user starts music', async () => {
    let finish!: (url: string) => void;
    noteMedia.acquireNoteMediaObjectUrl.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
    render(true);
    const note = useVoicePlayerStore.getState();
    try {
      act(() => note.play('note', 'voice'));
      expect(useVoicePlayerStore.getState().loading).toBe(true);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
      await act(async () => finish('blob:note-voice'));
      expect(noteMedia.releaseNoteMediaObjectUrl).toHaveBeenCalledWith('note', 'voice');
      expect(useVoicePlayerStore.getState().loading).toBe(false);
      expect(useVoicePlayerStore.getState().playing).toBe(false);
      expect(container.querySelector('audio')?.paused).toBe(false);
    } finally { act(() => note.reset()); }
  });
});
