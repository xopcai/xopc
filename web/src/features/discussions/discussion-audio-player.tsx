import { Pause, Play, Repeat, RotateCcw, RotateCw } from 'lucide-react';
import {
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import { claimNativePlayback, releasePlayback } from '@/features/media-playback/playback-coordinator';
import { cn } from '@/lib/cn';

import type { DiscussionTranscriptSegment } from './discussion-types';

const SPEED_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

const formatClock = (ms: number): string => {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export interface DiscussionPlayerMarker {
  id: string;
  label: string;
  atMs: number;
  kind: 'chapter' | 'highlight';
}

export interface DiscussionAudioPlayerProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioSourceKey: string;
  src: string;
  zh: boolean;
  positionMs: number;
  durationMs: number;
  segments: DiscussionTranscriptSegment[];
  markers?: DiscussionPlayerMarker[];
  continuousMode: boolean;
  onToggleContinuousMode: () => void;
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
  onUserScrub: (ms: number) => void;
  onDurationChange: (event: SyntheticEvent<HTMLAudioElement>) => void;
  onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => void;
  onLoadedMetadata: (event: SyntheticEvent<HTMLAudioElement>) => void;
  onError: () => void;
}

export function DiscussionAudioPlayer({
  audioRef,
  audioSourceKey,
  src,
  zh,
  positionMs,
  durationMs,
  segments,
  markers = [],
  continuousMode,
  onToggleContinuousMode,
  autoFollow,
  onToggleAutoFollow,
  onUserScrub,
  onDurationChange,
  onTimeUpdate,
  onLoadedMetadata,
  onError,
}: DiscussionAudioPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);

  const effectiveDurationMs = useMemo(() => {
    if (durationMs > 0) return durationMs;
    const maxSeg = segments.reduce((max, s) => Math.max(max, s.endedAtMs || 0), 0);
    return Math.max(maxSeg, positionMs, 1_000);
  }, [durationMs, positionMs, segments]);

  const progressRatio = Math.min(1, Math.max(0, positionMs / effectiveDurationMs));

  // Build 48 density bars representing speech energy / transcript coverage across the timeline
  const waveformBars = useMemo(() => {
    const count = 48;
    const bucketMs = effectiveDurationMs / count;
    return Array.from({ length: count }, (_, idx) => {
      const start = idx * bucketMs;
      const end = start + bucketMs;
      let chars = 0;
      for (const seg of segments) {
        if (seg.endedAtMs <= start || seg.startedAtMs >= end) continue;
        chars += (seg.displayText ?? seg.rawText ?? '').length;
      }
      if (chars === 0) return 0.22;
      return Math.min(1, 0.3 + Math.log10(chars + 1) * 0.36);
    });
  }, [effectiveDurationMs, segments]);

  const togglePlayPause = () => {
    const player = audioRef.current;
    if (!player) return;
    if (player.paused) {
      claimNativePlayback(player);
      void player.play().catch(() => {
        if (player.paused) releasePlayback(player);
      });
    } else {
      player.pause();
      releasePlayback(player);
    }
  };

  const skipBy = (deltaMs: number) => {
    const nextMs = Math.max(0, Math.min(effectiveDurationMs, positionMs + deltaMs));
    onUserScrub(nextMs);
  };

  const cycleRate = () => {
    const idx = SPEED_RATES.indexOf(rate as (typeof SPEED_RATES)[number]);
    const next = SPEED_RATES[(idx + 1) % SPEED_RATES.length];
    setRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const computeMs = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * effectiveDurationMs);
    };
    onUserScrub(computeMs(event.clientX));

    const pointerId = event.pointerId;
    try {
      track.setPointerCapture(pointerId);
    } catch {
      /* ignore in jsdom */
    }

    const onMove = (ev: PointerEvent) => onUserScrub(computeMs(ev.clientX));
    const onUp = () => {
      try {
        track.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      role="region"
      aria-label={zh ? '录音播放器' : 'Audio player'}
      className="mx-5 mb-2.5 shrink-0 rounded-xl border border-edge-subtle bg-surface-base/60 px-3.5 py-2 sm:mx-7"
    >
      {/* Keep underlying <audio> mounted at stable DOM location for playback coordinator & tests */}
      <audio
        key={audioSourceKey}
        ref={audioRef}
        preload="metadata"
        className="sr-only"
        src={src}
        aria-label={zh ? '录音播放器' : 'Recording player'}
        onPlay={() => {
          setPlaying(true);
          if (audioRef.current) audioRef.current.playbackRate = rate;
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onDurationChange={onDurationChange}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onError={onError}
      />

      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        {/* Transport Controls */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => skipBy(-15_000)}
            aria-label={zh ? '快退 15 秒' : 'Back 15 seconds'}
            title={zh ? '快退 15 秒' : 'Back 15s'}
            className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={togglePlayPause}
            aria-label={playing ? (zh ? '暂停播放' : 'Pause recording') : (zh ? '播放录音' : 'Play recording')}
            className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-on-accent shadow-xs transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="ml-0.5 size-4" aria-hidden />}
          </button>

          <button
            type="button"
            onClick={() => skipBy(15_000)}
            aria-label={zh ? '快进 15 秒' : 'Forward 15 seconds'}
            title={zh ? '快进 15 秒' : 'Forward 15s'}
            className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCw className="size-3.5" aria-hidden />
          </button>
        </div>

        {/* Time Readout */}
        <div className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
          <span className="font-medium text-fg">{formatClock(positionMs)}</span>
          <span className="mx-1 text-fg-subtle">/</span>
          <span>{formatClock(effectiveDurationMs)}</span>
        </div>

        {/* Waveform + Chapter / Highlight Scrubber */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={zh ? '录音进度条' : 'Playback timeline'}
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDurationMs / 1000)}
          aria-valuenow={Math.round(positionMs / 1000)}
          onPointerDown={handleTrackPointerDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              skipBy(-5_000);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              skipBy(5_000);
            }
          }}
          className="group relative flex h-8 min-w-36 flex-1 cursor-pointer items-center select-none px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* Waveform density bars */}
          <div className="flex h-6 w-full items-center gap-[2px]" aria-hidden>
            {waveformBars.map((heightRatio, idx) => {
              const barRatio = (idx + 0.5) / waveformBars.length;
              const passed = barRatio <= progressRatio;
              return (
                <span
                  key={idx}
                  style={{ height: `${Math.round(heightRatio * 100)}%` }}
                  className={cn(
                    'flex-1 rounded-full transition-colors',
                    passed ? 'bg-accent' : 'bg-edge group-hover:bg-fg-subtle/50',
                  )}
                />
              );
            })}
          </div>

          {/* Chapter & Highlight Pins */}
          {markers.map((marker) => {
            const pct = Math.max(0, Math.min(100, (marker.atMs / effectiveDurationMs) * 100));
            return (
              <button
                key={marker.id}
                type="button"
                title={`${formatClock(marker.atMs)} · ${marker.label}`}
                aria-label={`${zh ? '跳转至' : 'Jump to'} ${marker.label}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onUserScrub(marker.atMs);
                }}
                style={{ left: `${pct}%` }}
                className={cn(
                  'absolute top-0.5 size-2 -translate-x-1/2 rounded-full ring-2 ring-surface-panel transition-transform hover:scale-125',
                  marker.kind === 'chapter' ? 'bg-accent-fg' : 'bg-warning',
                )}
              />
            );
          })}

          {/* Playhead thumb */}
          <span
            aria-hidden
            style={{ left: `${progressRatio * 100}%` }}
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface-panel shadow-xs"
          />
        </div>

        {/* Speed & Playback Mode Controls */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={cycleRate}
            aria-label={zh ? `播放倍速 ${rate}x` : `Playback speed ${rate}x`}
            title={zh ? '点击切换播放倍速' : 'Cycle playback speed'}
            className="h-7 rounded-md border border-edge-subtle bg-surface-inset px-2 font-mono text-xs font-medium tabular-nums text-fg hover:border-edge hover:bg-surface-hover"
          >
            {rate}x
          </button>

          <button
            type="button"
            onClick={onToggleContinuousMode}
            title={
              continuousMode
                ? zh
                  ? '当前：点击逐字稿连续播放（点击切换为单句回听自动停顿）'
                  : 'Continuous playback (click to pause after segment)'
                : zh
                  ? '当前：单句精听（播完本段自动暂停）'
                  : 'Segment clip mode (pauses at segment end)'
            }
            className={cn(
              'hidden h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors sm:inline-flex',
              continuousMode
                ? 'border-edge-subtle bg-surface-inset text-fg-muted hover:text-fg'
                : 'border-accent/40 bg-accent-soft text-accent-fg',
            )}
          >
            <Repeat className="size-3" aria-hidden />
            <span>{continuousMode ? (zh ? '连播' : 'Cont.') : (zh ? '单句' : 'Clip')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleAutoFollow}
            title={zh ? '播放时自动滚动定位逐字稿' : 'Auto-follow transcript while playing'}
            className={cn(
              'hidden h-7 items-center rounded-md border px-2 text-xs transition-colors md:inline-flex',
              autoFollow
                ? 'border-accent/35 bg-accent-soft/60 text-accent-fg'
                : 'border-edge-subtle bg-surface-inset text-fg-muted hover:text-fg',
            )}
          >
            {zh ? '同步滚屏' : 'Follow'}
          </button>
        </div>
      </div>
    </div>
  );
}
