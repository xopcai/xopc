import { Pause, Play, Loader2 } from 'lucide-react';
import { useCallback } from 'react';

import { cn } from '@/lib/cn';

import { useVoicePlayerStore } from './voice-player-store';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export type VoiceMiniPlayerProps = {
  noteId: string;
  attachmentId: string;
  durationSec?: number;
  className?: string;
};

export function VoiceMiniPlayer({ noteId, attachmentId, durationSec, className }: VoiceMiniPlayerProps) {
  const { playing, loading, currentTime, duration, noteId: activeNoteId, attachmentId: activeAttachmentId } =
    useVoicePlayerStore();
  const toggle = useVoicePlayerStore((s) => s.toggle);

  const isActive = activeNoteId === noteId && activeAttachmentId === attachmentId;
  const isPlaying = isActive && playing;
  const isLoading = isActive && loading;
  const progress = isActive ? currentTime : 0;
  const displayDuration = isActive && duration > 0 ? duration : (durationSec ?? 0);
  const progressPercent = displayDuration > 0 ? Math.min((progress / displayDuration) * 100, 100) : 0;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      toggle(noteId, attachmentId, durationSec);
    },
    [noteId, attachmentId, durationSec, toggle],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation();
        event.preventDefault();
        toggle(noteId, attachmentId, durationSec);
      }
    },
    [noteId, attachmentId, durationSec, toggle],
  );

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
          isPlaying
            ? 'bg-accent text-white'
            : 'bg-accent/10 text-accent hover:bg-accent/20',
        )}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5 ml-0.5" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-accent/10">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-fg-muted">
          {isActive && progress > 0 ? formatTime(progress) : formatTime(displayDuration)}
        </span>
      </div>
    </div>
  );
}
