import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, MoreVertical, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

import { NoteCoverThumbnail } from './note-cover-thumbnail';
import { formatRelativeTime, type NoteTimeLabels } from './note-time';
import type { NoteIndexEntry } from './notes-api';
import { VoiceMiniPlayer } from './voice-mini-player';

export type NoteCardProps = {
  note: NoteIndexEntry;
  selected?: boolean;
  onPress: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  timeLabels: NoteTimeLabels;
  labels: {
    pin: string;
    unpin: string;
    archive: string;
    delete: string;
    actions: string;
    imageNote: string;
    noText: string;
  };
};

function noteCardPreviewText(note: NoteIndexEntry, labels: NoteCardProps['labels']): string {
  if (note.snippet?.trim()) return note.snippet;
  if (note.coverAttachmentId) return labels.imageNote;
  return labels.noText;
}

export function NoteCard({ note, selected = false, onPress, onPin, onArchive, onDelete, labels, timeLabels }: NoteCardProps) {
  const previewText = noteCardPreviewText(note, labels);
  const isFallbackText = !note.snippet?.trim();
  const [nowMs] = useState(() => Date.now());
  const time = formatRelativeTime(note.createdAt, nowMs, timeLabels);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onPress(note.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPress(note.id);
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg px-3 py-2.5',
        'transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-rail',
        selected
          ? 'bg-surface-active hover:bg-surface-active'
          : 'bg-transparent hover:bg-surface-panel/70',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      {selected ? (
        <span className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-pill bg-accent" aria-hidden />
      ) : null}
      <div className="flex items-start gap-3">
        {note.coverAttachmentId ? (
          <NoteCoverThumbnail noteId={note.id} attachmentId={note.coverAttachmentId} />
        ) : note.kind === 'voice' && note.voiceAttachmentId ? (
          <VoiceMiniPlayer
            noteId={note.id}
            attachmentId={note.voiceAttachmentId}
            durationSec={note.voiceDurationSec}
            className="mt-0.5 w-28 shrink-0"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          {note.title && (
            <h3 className="mb-0.5 truncate text-sm font-semibold text-fg">{note.title}</h3>
          )}
          <p
            className={cn(
              'truncate text-sm leading-5',
              note.title ? 'text-fg-muted' : isFallbackText ? 'italic text-fg-muted' : 'text-fg',
            )}
          >
            {previewText}
          </p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded-md p-1 text-fg-muted opacity-100 transition-opacity hover:bg-surface-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
              aria-label={labels.actions}
              title={labels.actions}
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[140px] rounded-xl border border-edge bg-surface-panel p-1 shadow-lg"
              sideOffset={4}
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                onSelect={() => onPin(note.id, !note.pinned)}
              >
                {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {note.pinned ? labels.unpin : labels.pin}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                onSelect={() => onArchive(note.id)}
              >
                <Archive className="size-4" />
                {labels.archive}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 outline-none hover:bg-surface-hover focus:bg-surface-hover"
                onSelect={() => onDelete(note.id)}
              >
                <Trash2 className="size-4" />
                {labels.delete}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {note.pinned && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
            <Pin className="size-3" />
          </span>
        )}
        {note.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="max-w-24 truncate rounded-md bg-surface-hover px-1.5 py-0.5 text-xs text-fg-muted"
          >
            {tag}
          </span>
        ))}
        <span className="ml-auto text-xs text-fg-muted">{time}</span>
      </div>
    </article>
  );
}
