import { Mic, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { mediaUriToReadUrl } from '@/features/chat/attachments/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

/** `<audio.duration>` often reports 0 / NaN / Infinity for recorder WebMs; element duration must pass this gate. */
function isUsableHtmlAudioDuration(sec: number): boolean {
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0 && sec !== Infinity;
}

function formatDur(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isAudioAtt(att: MessageAttachment): boolean {
  return att.type === 'voice' || att.type === 'audio' || att.mimeType?.startsWith('audio/') === true;
}

/**
 * Inline voice playback — compact chip nests in user tinted bubble; default matches panel typography (DESIGN.md).
 */
export function VoiceMessageBar({
  att,
  align = 'start',
  variant = 'default',
  sessionKey,
}: {
  att: MessageAttachment;
  align?: 'start' | 'end' | 'center';
  variant?: 'default' | 'compact';
  sessionKey?: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackId = useId();
  const [src, setSrc] = useState<string | undefined>();
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const hintDuration = useMemo(() => {
    const d = att.durationSeconds;
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0;
  }, [att.durationSeconds]);

  const [duration, setDuration] = useState(hintDuration);
  const trackedHintRef = useRef(hintDuration);
  if (trackedHintRef.current !== hintDuration) {
    trackedHintRef.current = hintDuration;
    setDuration(hintDuration);
  }
  const [current, setCurrent] = useState(0);

  const syncDurationFromElement = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const d = el.duration;
    if (isUsableHtmlAudioDuration(d)) {
      setDuration(d);
    }
  }, []);

  const attPlaybackKey = `${att.uri ?? ''}:${att.content?.length ?? 0}:${att.mimeType ?? ''}`;
  const trackedAttPlaybackRef = useRef(attPlaybackKey);
  if (trackedAttPlaybackRef.current !== attPlaybackKey) {
    trackedAttPlaybackRef.current = attPlaybackKey;
    setCurrent(0);
    setPlaying(false);
  }

  useEffect(() => {
    let revoke: string | undefined;
    let cancelled = false;
    const run = async () => {
      const raw = att.content ?? att.data;
      if (raw) {
        const mime = att.mimeType?.includes('/') ? att.mimeType : 'audio/mpeg';
        setSrc(`data:${mime};base64,${raw.replace(/\s/g, '')}`);
        return;
      }
      if (!att.uri) return;
      try {
        const res = await apiFetch(apiUrl(mediaUriToReadUrl(att.uri, sessionKey, att.taskId)));
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        revoke = u;
        setSrc(u);
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [att, sessionKey]);

  useEffect(() => {
    const pauseForRecording = () => audioRef.current?.pause();
    const pauseForOtherPlayback = (event: Event) => {
      const otherId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (otherId && otherId !== playbackId) audioRef.current?.pause();
    };
    window.addEventListener('xopc-voice-recording-start', pauseForRecording);
    window.addEventListener('xopc-voice-playback-start', pauseForOtherPlayback);
    return () => {
      window.removeEventListener('xopc-voice-recording-start', pauseForRecording);
      window.removeEventListener('xopc-voice-playback-start', pauseForOtherPlayback);
    };
  }, [playbackId]);


  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !src) return;
    if (playing) {
      el.pause();
    } else {
      void el.play().catch(() => {});
    }
  }, [playing, src]);

  if (!isAudioAtt(att)) return null;

  const pct =
    duration > 0 ? Math.min(100, Number.isFinite(duration) ? (current / duration) * 100 : 0) : 0;
  const durationReady =
    typeof duration === 'number' && duration > 0 && Number.isFinite(duration);

  /** True when metadata not yet surfaced */
  const awaitingMeta = Boolean(src && !durationReady);

  const timeCaptionEl = !src ? (
    <span className="tabular-nums tracking-tight text-fg-subtle">— / —</span>
  ) : (
    <span className="tabular-nums tracking-tight text-fg-muted" aria-live="polite">
      <span>{formatDur(current)}</span>
      <span className="mx-0.5 text-fg-subtle">/</span>
      {!durationReady ? (
        <span className="text-fg-subtle" title={m.chat.voiceAwaitingMeta}>
          —
        </span>
      ) : (
        <span>{formatDur(duration)}</span>
      )}
    </span>
  );

  const audioEl = src ? (
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      className="hidden"
      onLoadedMetadata={syncDurationFromElement}
      onLoadedData={syncDurationFromElement}
      onDurationChange={syncDurationFromElement}
      onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      onPlay={(event) => {
        event.currentTarget.playbackRate = playbackRate;
        window.dispatchEvent(new CustomEvent('xopc-voice-playback-start', { detail: { id: playbackId } }));
        setPlaying(true);
      }}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false);
        setCurrent(0);
      }}
    />
  ) : (
    <span className="sr-only">{m.chat.voiceLoading}</span>
  );

  const playBtn = (
    <button
      type="button"
      onClick={toggle}
      disabled={!src}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full border text-accent-fg',
        'border-edge-subtle bg-surface-panel transition-colors',
        'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'motion-safe:active:scale-[0.97]',
        'dark:bg-surface-panel/90 dark:border-edge',
        variant === 'compact' &&
          cn(
            'border-white/55 bg-white/92 shadow-[inset_0_1px_0_rgb(255_255_255/0.65)]',
            'dark:border-white/14 dark:bg-surface-hover/98 dark:shadow-none',
          ),
        !src && 'opacity-50',
      )}
      aria-label={playing ? m.chat.voicePause : m.chat.voicePlay}
      title={playing ? m.chat.voicePause : m.chat.voicePlay}
    >
      {playing ? <Pause className="size-[14px]" strokeWidth={2} /> : <Play className="size-[14px] ml-px" strokeWidth={2} />}
    </button>
  );

  const trackBg = cn(
    'relative h-0.5 min-h-[2px] w-full overflow-hidden rounded-full bg-edge-subtle dark:bg-edge/65',
    variant === 'compact' && 'bg-white/45 dark:bg-white/14',
  );

  const shellClass = cn(
    'inline-flex min-w-0 items-center rounded-full border',
    variant === 'compact'
      ? 'max-w-[min(220px,88vw)] gap-2 px-2 py-1.5 backdrop-blur-[2px]'
      : 'min-w-[min(160px,80vw)] max-w-[17rem] gap-2 px-2 py-1.5',
    variant === 'compact'
      ? 'border-white/58 bg-white/86 shadow-none dark:border-white/13 dark:bg-black/[0.22] dark:backdrop-blur-sm'
      : 'border-edge-subtle bg-surface-panel/[0.96] shadow-surface dark:border-edge dark:bg-surface-panel/92',
  );

  const label = `${m.chat.voiceAriaRegion}${att.name ? ` · ${att.name}` : ''}`;

  return (
    <div
      className={cn(
        'flex min-w-0',
        align === 'end' && 'justify-end',
        align === 'center' && 'justify-center',
      )}
    >
      <div role="group" aria-label={label} className={shellClass}>
        {playBtn}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-px">
          {variant === 'default' ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-snug tracking-tight text-fg-muted">
              <Mic className="size-3 shrink-0 opacity-90 text-fg-subtle" strokeWidth={1.75} aria-hidden />
              <span className="truncate font-normal">{m.chat.voiceMessage}</span>
            </div>
          ) : (
            <span className="sr-only">{m.chat.voiceMessage}</span>
          )}
          <div className={trackBg} aria-hidden>
            {!src ? null : awaitingMeta ? (
              <span
                className={cn(
                  'absolute inset-y-0 left-[18%] w-[42%] max-w-[4.5rem] rounded-full bg-accent/45 motion-safe:animate-pulse',
                )}
              />
            ) : (
              <div
                className={cn(
                  'h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-linear',
                )}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className={cn('flex justify-end text-[10px] leading-snug tracking-tight text-fg-muted')}>{timeCaptionEl}</div>
        </div>
        {src ? (
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-[10px] tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg"
            title={m.chat.voicePlaybackSpeed}
            aria-label={`${m.chat.voicePlaybackSpeed}: ${playbackRate}×`}
            onClick={() => {
              const next = playbackRate === 1 ? 1.25 : playbackRate === 1.25 ? 1.5 : playbackRate === 1.5 ? 0.75 : 1;
              setPlaybackRate(next);
              if (audioRef.current) audioRef.current.playbackRate = next;
            }}
          >
            {playbackRate}×
          </button>
        ) : null}
        {audioEl}
      </div>
    </div>
  );
}
