import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, Bookmark, CheckSquare, Lightbulb, Mic, MoreVertical, Image, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

import { NoteCoverThumbnail } from './note-cover-thumbnail';
import { formatRelativeTime, type NoteTimeLabels } from './note-time';
import type { NoteIndexEntry, NoteKind } from './notes-api';
import { VoiceMiniPlayer } from './voice-mini-player';

const KIND_ICON: Record<NoteKind, typeof Lightbulb> = {
  thought: Lightbulb,
  todo: CheckSquare,
  voice: Mic,
  media: Image,
  bookmark: Bookmark,
  mixed: Lightbulb,
  task: CheckSquare,
};

export type NoteCardProps = {
  note: NoteIndexEntry;
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
    imageNote: string;
    noText: string;
  };
};

function noteCardPreviewText(note: NoteIndexEntry, labels: NoteCardProps['labels']): string {
  if (note.snippet?.trim()) return note.snippet;
  if (note.coverAttachmentId) return labels.imageNote;
  return labels.noText;
}

export function NoteCard({ note, onPress, onPin, onArchive, onDelete, labels, timeLabels }: NoteCardProps) {
  const Icon = KIND_ICON[note.kind] || Lightbulb;
  const previewText = noteCardPreviewText(note, labels);
  const isFallbackText = !note.snippet?.trim();
  const [nowMs] = useState(() => Date.now());
  const time = formatRelativeTime(note.createdAt, nowMs, timeLabels);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onPress(note.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPress(note.id); }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-base p-4',
        'transition-colors duration-150 ease-out hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
      )}
    >
      <div className="flex items-start gap-3">
        {note.coverAttachmentId ? (
          <NoteCoverThumbnail noteId={note.id} attachmentId={note.coverAttachmentId} />
        ) : note.kind === 'voice' && note.voiceAttachmentId ? (
          <VoiceMiniPlayer
            noteId={note.id}
            attachmentId={note.voiceAttachmentId}
            durationSec={note.voiceDurationSec}
            className="mt-0.5 w-32 shrink-0"
          />
        ) : (
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
        )}
        <div className="min-w-0 flex-1">
          {note.title && (
            <h3 className="mb-0.5 truncate text-sm font-semibold text-fg">{note.title}</h3>
          )}
          <p
            className={cn(
              'text-sm line-clamp-3',
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
              className="shrink-0 rounded-md p-1 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Actions"
            >
              <MoreVertical className="h-4 w-4" />
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
                {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                {note.pinned ? labels.unpin : labels.pin}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                onSelect={() => onArchive(note.id)}
              >
                <Archive className="h-4 w-4" />
                {labels.archive}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 outline-none hover:bg-surface-hover focus:bg-surface-hover"
                onSelect={() => onDelete(note.id)}
              >
                <Trash2 className="h-4 w-4" />
                {labels.delete}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="flex items-center gap-2">
        {note.pinned && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
            <Pin className="h-3 w-3" />
          </span>
        )}
        {note.tags?.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-surface-hover px-1.5 py-0.5 text-xs text-fg-muted"
          >
            {tag}
          </span>
        ))}
        <span className="ml-auto text-xs text-fg-muted">{time}</span>
      </div>
    </article>
  );
}
