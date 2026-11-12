import * as Popover from '@radix-ui/react-popover';
import { Download, LoaderCircle, MessageSquareQuote, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { formatPlaybackTime, useGeneratedMedia, useGeneratedMediaControls } from '@/features/media-playback/use-generated-media';
import { cn } from '@/lib/cn';

const copy = {
  zh: {
    play: '播放', pause: '暂停', retry: '重试播放', loading: '正在加载音频', error: '音频暂时无法播放，请重试。',
    seek: '播放进度', lyrics: '歌词', volume: '音量', mute: '静音', unmute: '取消静音', download: '下载音频',
  },
  en: {
    play: 'Play', pause: 'Pause', retry: 'Retry playback', loading: 'Loading audio', error: 'Audio could not play. Try again.',
    seek: 'Playback position', lyrics: 'Lyrics', volume: 'Volume', mute: 'Mute', unmute: 'Unmute', download: 'Download audio',
  },
};

export function MusicPlayer({ src, title, durationMs, lyrics, lyricsOpen, onToggleLyrics, language }: {
  src: string;
  title: string;
  durationMs: number | null;
  lyrics?: string | null;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  language: keyof typeof copy;
}) {
  const m = copy[language];
  const id = useId();
  const { element, hostRef } = useGeneratedMedia({ kind: 'audio', src, title });
  const { position, duration, muted, volume, starting: loading, playing, failed, toggle, seek } = useGeneratedMediaControls(element);
  const total = duration || (durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : 0);
  const current = Math.min(position, total);
  const canPause = playing || loading;
  const hasLyrics = Boolean(lyrics?.trim());
  const PlaybackIcon = failed ? RotateCcw : loading ? LoaderCircle : canPause ? Pause : Play;
  const VolumeIcon = muted || volume === 0 ? VolumeX : Volume2;

  return <div role="group" aria-label={title}>
    <div className="space-y-1">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 text-xs tabular-nums text-fg-muted">
        <span aria-hidden className="min-w-[3.5ch]">{formatPlaybackTime(current)}</span>
        <div className="relative flex h-6 items-center">
          <div aria-hidden className="pointer-events-none absolute inset-x-1.5 h-1 overflow-hidden rounded-full bg-edge-strong">
            <div className="h-full rounded-full bg-fg" style={{ width: `${total ? (current / total) * 100 : 0}%` }} />
          </div>
          <input type="range" min={0} max={total || 1} step={0.1} value={current} disabled={!duration || failed}
            aria-label={m.seek} aria-valuetext={`${formatPlaybackTime(current)} / ${total ? formatPlaybackTime(total) : '—'}`}
            onChange={event => seek(event.currentTarget.valueAsNumber)}
            className="relative block h-full w-full cursor-pointer appearance-none rounded-md bg-transparent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-0 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg" />
        </div>
        <span aria-hidden className="min-w-[3.5ch] text-end">{total ? formatPlaybackTime(total) : '—'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="size-11 shrink-0 rounded-full bg-fg p-0 text-surface-panel hover:bg-fg/85 hover:text-surface-panel"
          onClick={toggle} aria-label={failed ? m.retry : canPause ? m.pause : m.play}>
          <PlaybackIcon size={20} aria-hidden className={cn(loading && 'motion-safe:animate-spin',
            !canPause && !failed && 'ms-0.5 fill-current', playing && 'fill-current')} />
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {hasLyrics && <Button variant="ghost" className={cn('min-h-11 gap-1.5 rounded-full px-2.5 text-xs',
            lyricsOpen && 'bg-accent-soft text-accent-fg hover:text-accent-fg')}
            aria-controls={`${id}-lyrics`} aria-expanded={lyricsOpen} onClick={onToggleLyrics}>
            <MessageSquareQuote size={17} aria-hidden />{m.lyrics}
          </Button>}
          <Button asChild variant="ghost" className="size-11 rounded-full p-0">
            <a href={`${src}?download=1`} download="music.mp3" aria-label={m.download} title={m.download}>
              <Download size={18} aria-hidden />
            </a>
          </Button>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="ghost" className="size-11 rounded-full p-0" aria-label={m.volume} title={m.volume}>
                <VolumeIcon size={18} aria-hidden />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="end" sideOffset={6} aria-label={m.volume}
                className="z-50 flex items-center gap-2 rounded-xl border border-edge bg-surface-overlay p-2 shadow-float">
                <Button variant="ghost" className="size-11 rounded-full p-0" aria-label={muted ? m.unmute : m.mute}
                  onClick={() => { if (element) element.muted = !element.muted; }}>
                  <VolumeIcon size={17} aria-hidden />
                </Button>
                <input type="range" min={0} max={100} step={1} value={muted ? 0 : Math.round(volume * 100)}
                  aria-label={m.volume} className="h-8 w-28 cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-accent"
                  onChange={event => {
                    if (!element) return;
                    element.volume = event.currentTarget.valueAsNumber / 100;
                    element.muted = false;
                  }} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    </div>
    {loading && <p role="status" className="sr-only">{m.loading}</p>}
    {failed && <p role="alert" className="px-3 pb-3 text-xs text-fg-muted">{m.error}</p>}
    {hasLyrics && <div id={`${id}-lyrics`} hidden={!lyricsOpen} role="region" aria-label={m.lyrics} tabIndex={0}
      className="mt-2 max-h-[clamp(5rem,calc(100dvh-15rem),17rem)] overflow-y-auto overscroll-y-auto rounded-xl border border-edge bg-surface-inset px-4 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-5">
      {lyricsOpen && <p className="whitespace-pre-wrap wrap-anywhere text-[0.9375rem] leading-6 font-normal text-fg">{lyrics}</p>}
    </div>}
    <div ref={hostRef} hidden />
  </div>;
}
