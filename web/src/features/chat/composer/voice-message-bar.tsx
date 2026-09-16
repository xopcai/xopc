import { ChevronDown, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { mediaUriToReadUrl } from '@/features/chat/attachments/attachment-utils-core';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function validDuration(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

type Props = {
  att: MessageAttachment;
  align?: 'start' | 'end' | 'center';
  embedded?: boolean;
  sessionKey?: string | null;
};

export function VoiceMessageBar(props: Props) {
  const { att, sessionKey } = props;
  // Reset playback and release the previous source when a message attachment changes.
  return <VoiceClip key={JSON.stringify([att.uri, att.content, att.data, att.taskId, sessionKey])} {...props} />;
}

function VoiceClip({ att, align = 'start', embedded = false, sessionKey }: Props) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const m = messages(language).chat;
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const [measuredDuration, setDuration] = useState(0);
  const duration = measuredDuration || (validDuration(att.durationSeconds) ? att.durationSeconds : 0);
  const [current, setCurrent] = useState(0);
  const raw = att.content ?? att.data;

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setError(false);
    setSrc(undefined);
    const load = async () => {
      try {
        if (raw) {
          setSrc(`data:${att.mimeType || 'audio/mpeg'};base64,${raw.replace(/\s/g, '')}`);
          return;
        }
        if (!att.uri) throw new Error('Missing audio source');
        const response = await apiFetch(apiUrl(mediaUriToReadUrl(att.uri, sessionKey, att.taskId)), { signal: controller.signal });
        if (!response.ok) throw new Error('Audio unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void load();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [raw, att.mimeType, att.uri, att.taskId, sessionKey, attempt]);

  useEffect(() => {
    const audio = audioRef.current;
    const pause = () => audio?.pause();
    const otherPlayback = (event: Event) => {
      const otherId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (otherId && otherId !== id) pause();
    };
    window.addEventListener('xopc-voice-recording-start', pause);
    window.addEventListener('xopc-voice-playback-start', otherPlayback);
    return () => {
      pause();
      window.removeEventListener('xopc-voice-recording-start', pause);
      window.removeEventListener('xopc-voice-playback-start', otherPlayback);
    };
  }, [id]);

  const toggle = () => {
    const audio = audioRef.current;
    if (error) { setAttempt((value) => value + 1); return; }
    if (!audio || !src) return;
    if (playing) audio.pause();
    else void audio.play().catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(true);
    });
  };
  const syncDuration = () => {
    const value = audioRef.current?.duration;
    if (validDuration(value)) setDuration(value);
  };
  const optionsLabel = zh ? '播放选项' : 'Playback options';
  return <div className={cn('flex min-w-0', align === 'end' && 'justify-end', align === 'center' && 'justify-center')}>
    <div className={cn('w-60 max-w-full rounded-xl', !embedded && 'bg-surface-base px-1')} role="group" aria-label={m.voiceAriaRegion}>
      {!src && !error ? <span className="sr-only" role="status">{m.voiceLoading}</span> : null}
      <div className="flex min-h-14 items-center gap-2">
        <button type="button" onClick={toggle} disabled={!src && !error}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg hover:bg-surface-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={error ? (zh ? '重试播放' : 'Retry playback') : playing ? m.voicePause : m.voicePlay}>
          {error ? <RotateCcw className="size-5" aria-hidden /> : playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1" aria-hidden>
          {!src && !error ? <Skeleton className="h-1 w-full" /> : <div className="h-1 overflow-hidden rounded-full bg-surface-active"><div className="h-full rounded-full bg-accent" style={{ width: `${duration > 0 ? Math.min(100, current / duration * 100) : 0}%` }} /></div>}
        </div>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-label={optionsLabel} aria-expanded={expanded} aria-controls={`${id}-options`}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] tabular-nums text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {current > 0 || duration > 0 ? formatDuration(current > 0 ? current : duration) : '—'}<ChevronDown className={cn('size-3', expanded && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {error ? <p role="alert" className="px-2 pb-2 text-xs text-fg-muted">{zh ? '音频无法播放，请重试' : 'Audio unavailable. Try again.'}</p> : null}
      {expanded ? <div id={`${id}-options`} className="space-y-2 px-2 pb-3">
        <label className="block text-xs text-fg-muted">{zh ? '播放进度' : 'Playback position'}
          <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(current, duration)} disabled={!src || !duration || error}
            onChange={(event) => { if (audioRef.current) { audioRef.current.currentTime = Number(event.target.value); setCurrent(Number(event.target.value)); } }}
            className="block h-11 w-full accent-accent" />
        </label>
        <PopoverSelect contentClassName="[&_button]:min-h-11" value={String(rate)} allowEmpty={false} placeholder="1×" ariaLabel={m.voicePlaybackSpeed}
          triggerClassName="min-h-11" options={[0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}×` }))}
          onChange={(value) => { const next = Number(value); setRate(next); if (audioRef.current) audioRef.current.playbackRate = next; }} />
      </div> : null}
      {att.extractedText?.trim() ? <div className="px-2 pb-1">
        <button type="button" className="min-h-11 rounded-lg text-xs text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => setTranscriptOpen(!transcriptOpen)} aria-expanded={transcriptOpen} aria-controls={`${id}-text`}>
          {transcriptOpen ? (zh ? '收起文字' : 'Hide transcript') : (zh ? '查看文字' : 'Show transcript')}
        </button>
        {transcriptOpen ? <p id={`${id}-text`} className="whitespace-pre-wrap break-words pb-2 text-sm text-fg-muted">{att.extractedText}</p> : null}
      </div> : null}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" onLoadedMetadata={syncDuration} onDurationChange={syncDuration}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onError={() => { if (src) { setPlaying(false); setError(true); } }}
        onPlay={(event) => { event.currentTarget.playbackRate = rate; setPlaying(true); window.dispatchEvent(new CustomEvent('xopc-voice-playback-start', { detail: { id } })); }}
        onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrent(0); }} />
    </div>
  </div>;
}
