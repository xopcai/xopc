import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages.types';
import { workspaceRelativePathToApiPath } from '@/features/chat/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

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
 * User voice: single play control + duration. Assistant TTS: full bar with progress.
 */
export function VoiceMessageBar({
  att,
  align = 'start',
  variant = 'default',
}: {
  att: MessageAttachment;
  align?: 'start' | 'end';
  /** `compact` = one play button + duration only (user messages). */
  variant?: 'default' | 'compact';
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | undefined>();
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    let revoke: string | undefined;
    let cancelled = false;
    const run = async () => {
      const raw = att.content ?? att.data;
      if (raw) {
        const mime = att.mimeType?.includes('/') ? att.mimeType : 'audio/mpeg';
        setSrc(`data:${mime};base64,${raw.replace(/\s/g, '')}`);
        return;
      }
      if (!att.workspaceRelativePath) return;
      try {
        const res = await apiFetch(apiUrl(workspaceRelativePathToApiPath(att.workspaceRelativePath)));
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
  }, [att]);

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

  const audioEl = src ? (
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      className="hidden"
      onLoadedMetadata={() => {
        const d = audioRef.current?.duration;
        if (typeof d === 'number' && Number.isFinite(d)) setDuration(d);
      }}
      onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false);
        setCurrent(0);
      }}
    />
  ) : (
    <span className="sr-only">{m.chat.voiceLoading}</span>
  );

  if (variant === 'compact') {
    const timeText =
      duration > 0
        ? playing
          ? `${formatDur(current)} / ${formatDur(duration)}`
          : formatDur(duration)
        : src
          ? '…'
          : '—';

    return (
      <div className={cn('flex w-full min-w-0', align === 'end' && 'justify-end')}>
        <div className="inline-flex max-w-[min(280px,90vw)] items-center gap-3 rounded-full border border-edge bg-surface-hover/80 px-2.5 py-1.5 shadow-sm dark:border-edge dark:bg-surface-hover/50">
          <button
            type="button"
            onClick={toggle}
            disabled={!src}
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg',
              'hover:bg-accent-soft/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              !src && 'opacity-50',
            )}
            aria-label={playing ? m.chat.voicePause : m.chat.voicePlay}
            title={playing ? m.chat.voicePause : m.chat.voicePlay}
          >
            {playing ? <Pause className="size-[18px]" /> : <Play className="size-[18px] ml-0.5" />}
          </button>
          <span className="min-w-[4.25rem] tabular-nums text-sm font-semibold text-fg">{timeText}</span>
          {audioEl}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex w-full min-w-0', align === 'end' && 'justify-end')}>
      <div className="inline-flex min-w-[min(240px,85vw)] max-w-sm items-center gap-2 rounded-full border border-edge bg-surface-hover/80 px-3 py-2 text-left shadow-sm dark:border-edge dark:bg-surface-hover/50">
        <button
          type="button"
          onClick={toggle}
          disabled={!src}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg',
            'hover:bg-accent-soft/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            !src && 'opacity-50',
          )}
          aria-label={playing ? m.chat.voicePause : m.chat.voicePlay}
          title={playing ? m.chat.voicePause : m.chat.voicePlay}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge-subtle/80">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150 ease-linear"
              style={{ width: `${duration > 0 ? Math.min(100, (current / duration) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between gap-2 text-[10px] tabular-nums text-fg-muted">
            <span className="min-w-0 truncate">{m.chat.voiceMessage}</span>
            <span className="shrink-0">
              {duration > 0 ? `${formatDur(current)} / ${formatDur(duration)}` : '—'}
            </span>
          </div>
        </div>
        {audioEl}
      </div>
    </div>
  );
}
