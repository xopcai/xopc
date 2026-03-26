import {
  Archive,
  ArchiveRestore,
  Download,
  MessageSquare,
  Pin,
  PinOff,
  Trash2,
  Zap,
} from 'lucide-react';

import type { SessionMetadata } from '@/features/sessions/session.types';
import { ghostIconButton } from '@/lib/interaction';
import { cn } from '@/lib/cn';

export type SessionCardAction =
  | 'continue'
  | 'delete'
  | 'archive'
  | 'unarchive'
  | 'pin'
  | 'unpin'
  | 'export';

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export function SessionCard({
  session,
  variant,
  labels,
  onOpen,
  onAction,
}: {
  session: SessionMetadata;
  variant: 'grid' | 'list';
  labels: {
    continueChat: string;
    archive: string;
    unarchive: string;
    pin: string;
    unpin: string;
    export: string;
    delete: string;
    /** Shown when `session.name` is empty (e.g. new chat before auto-title). */
    unnamedSession: string;
  };
  onOpen: () => void;
  onAction: (action: SessionCardAction) => void;
}) {
  const displayName = session.name?.trim() || labels.unnamedSession;
  const showKeySubtitle = Boolean(session.name?.trim());
  const isArchived = session.status === 'archived';
  const isPinned = session.status === 'pinned';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        // min-w-0: grid/flex children default to min-width:auto — long unbroken titles (URLs) otherwise expand the track
        'group flex min-w-0 w-full max-w-full cursor-pointer flex-col rounded-xl bg-surface-base text-left transition-colors duration-150 ease-out',
        'hover:bg-surface-hover active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        variant === 'list' && 'sm:flex-row sm:items-center sm:gap-4',
      )}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className={cn(
          'flex min-w-0 items-start justify-between gap-2 bg-surface-hover/35 px-3 py-2 dark:bg-surface-hover/25',
          variant === 'list' && 'sm:py-3',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {session.sourceChannel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
          {isPinned ? <Pin className="size-3.5 text-accent-fg" strokeWidth={1.75} aria-hidden /> : null}
          <span>{formatRelativeDate(session.updatedAt)}</span>
        </div>
      </div>

      <div className={cn('min-w-0 flex-1 px-3 py-2', variant === 'list' && 'sm:py-3')}>
        <div className="min-w-0 max-w-full truncate text-sm font-semibold text-fg" title={displayName}>
          {displayName}
        </div>
        {showKeySubtitle ? (
          <div
            className="mt-0.5 min-w-0 max-w-full truncate font-mono text-[11px] text-fg-subtle"
            title={session.key}
          >
            {session.key}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
            {session.messageCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="size-3.5" strokeWidth={1.75} aria-hidden />
            {formatTokens(session.estimatedTokens)}
          </span>
        </div>
        {session.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {session.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="max-w-full break-words rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted"
              >
                {tag}
              </span>
            ))}
            {session.tags.length > 3 ? (
              <span className="text-[11px] text-fg-disabled">+{session.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-0.5 border-t border-edge-subtle/80 bg-surface-hover/25 px-2 py-2 dark:border-edge-subtle"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={ghostIconButton}
          title={labels.continueChat}
          aria-label={labels.continueChat}
          onClick={() => onAction('continue')}
        >
          <MessageSquare className="size-4" strokeWidth={1.75} />
        </button>
        {isArchived ? (
          <button
            type="button"
            className={ghostIconButton}
            title={labels.unarchive}
            aria-label={labels.unarchive}
            onClick={() => onAction('unarchive')}
          >
            <ArchiveRestore className="size-4" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            className={ghostIconButton}
            title={labels.archive}
            aria-label={labels.archive}
            onClick={() => onAction('archive')}
          >
            <Archive className="size-4" strokeWidth={1.75} />
          </button>
        )}
        {isPinned ? (
          <button
            type="button"
            className={ghostIconButton}
            title={labels.unpin}
            aria-label={labels.unpin}
            onClick={() => onAction('unpin')}
          >
            <PinOff className="size-4" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            className={ghostIconButton}
            title={labels.pin}
            aria-label={labels.pin}
            onClick={() => onAction('pin')}
          >
            <Pin className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          className={ghostIconButton}
          title={labels.export}
          aria-label={labels.export}
          onClick={() => onAction('export')}
        >
          <Download className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={cn(
            ghostIconButton,
            'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
          )}
          title={labels.delete}
          aria-label={labels.delete}
          onClick={() => onAction('delete')}
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
