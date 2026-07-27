import { Mic, Pause, Play, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { useVoicePlayerStore } from './voice-player-store';
import type { NoteAttachment } from './notes-api';

const PLAYBACK_RATES = [1, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export type VoiceNotePlayerProps = {
  noteId: string;
  attachment: NoteAttachment;
  transcript?: string;
  className?: string;
};

export function VoiceNotePlayer({ noteId, attachment, transcript, className }: VoiceNotePlayerProps) {
  const { playing, loading, currentTime, duration, noteId: activeNoteId, attachmentId: activeAttachmentId } =
    useVoicePlayerStore();
  const toggle = useVoicePlayerStore((s) => s.toggle);
  const seek = useVoicePlayerStore((s) => s.seek);

  const isActive = activeNoteId === noteId && activeAttachmentId === attachment.id;
  const isPlaying = isActive && playing;
  const isLoading = isActive && loading;
  const progress = isActive ? currentTime : 0;
  const displayDuration = isActive && duration > 0 ? duration : (attachment.duration ?? 0);
  const progressPercent = displayDuration > 0 ? Math.min((progress / displayDuration) * 100, 100) : 0;

  const [rateIndex, setRateIndex] = useState(0);
  const rangeRef = useRef<HTMLInputElement>(null);

  const handleToggle = useCallback(() => {
    toggle(noteId, attachment.id, attachment.duration);
  }, [noteId, attachment.id, attachment.duration, toggle]);

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const time = Number(event.target.value);
      seek(time);
    },
    [seek],
  );

  const handleRateChange = useCallback(() => {
    const nextIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
    setRateIndex(nextIndex);
  }, [rateIndex]);

  useEffect(() => {
    if (!isActive) return;
    const audio = document.querySelector('audio');
    if (audio) {
      audio.playbackRate = PLAYBACK_RATES[rateIndex];
    }
  }, [rateIndex, isActive, isPlaying]);

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-edge bg-surface-panel p-4', className)}>
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
          <Mic className="size-5 text-accent" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggle}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                isPlaying
                  ? 'bg-accent text-white'
                  : 'bg-accent/10 text-accent hover:bg-accent/20',
              )}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4 ml-0.5" />
              )}
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <input
                ref={rangeRef}
                type="range"
                min={0}
                max={displayDuration || 1}
                step={0.1}
                value={progress}
                onChange={handleSeek}
                className="voice-progress-range h-1.5 w-full cursor-pointer appearance-none rounded-full bg-accent/10 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) ${progressPercent}%, var(--color-accent-alpha-10, rgba(59,130,246,0.1)) ${progressPercent}%)`,
                }}
              />
              <div className="flex items-center justify-between text-[11px] tabular-nums text-fg-muted">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(displayDuration)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRateChange}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              aria-label="Playback speed"
            >
              {PLAYBACK_RATES[rateIndex]}x
            </button>
          </div>
        </div>
      </div>

      {transcript && (
        <div className="rounded-lg bg-surface-base px-3 py-2">
          <p className="text-sm leading-relaxed text-fg-muted">{transcript}</p>
        </div>
      )}
    </div>
  );
}
