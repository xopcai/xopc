import { Loader2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { ReadAloudInput } from './read-aloud-store';
import { useReadAloudStore } from './read-aloud-store';

export type ReadAloudLabels = {
  read: string;
  preparing: string;
  pause: string;
  resume: string;
  retry: string;
};

export function ReadAloudButton({
  input,
  labels,
  className,
  showLabel = false,
  disabled = false,
}: {
  input: ReadAloudInput | (() => ReadAloudInput);
  labels: ReadAloudLabels;
  className?: string;
  showLabel?: boolean;
  disabled?: boolean;
}) {
  const resolvedInput = typeof input === 'function' ? input() : input;
  const source = useReadAloudStore((state) => state.source);
  const status = useReadAloudStore((state) => state.status);
  const requestStart = useReadAloudStore((state) => state.requestStart);
  const active = source?.type === resolvedInput.source.type && source.id === resolvedInput.source.id;
  const activeStatus = active ? status : 'idle';
  const label = activeStatus === 'preparing'
    ? labels.preparing
    : activeStatus === 'playing'
      ? labels.pause
      : activeStatus === 'paused'
        ? labels.resume
        : activeStatus === 'error'
          ? labels.retry
          : labels.read;

  return (
    <button
      type="button"
      onClick={() => requestStart(typeof input === 'function' ? input() : input)}
      disabled={disabled || !resolvedInput.text.trim()}
      title={label}
      aria-label={label}
      aria-pressed={active && (activeStatus === 'playing' || activeStatus === 'paused')}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors transition-transform duration-150 ease-out',
        'hover:bg-surface-hover hover:text-fg active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        showLabel ? 'h-8 gap-1.5 px-2.5 text-xs font-medium' : 'size-9',
        active && 'bg-surface-active text-accent',
        className,
      )}
    >
      {activeStatus === 'preparing' ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : activeStatus === 'playing' ? (
        <Pause className="size-4" aria-hidden />
      ) : activeStatus === 'paused' ? (
        <Play className="size-4" aria-hidden />
      ) : activeStatus === 'error' ? (
        <RotateCcw className="size-4" aria-hidden />
      ) : (
        <Volume2 className="size-4" aria-hidden />
      )}
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
