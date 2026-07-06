import type { Note, NoteIndexEntry, NoteKind } from '../../query/notes';

import { resolveNoteListPreview } from './note-title';

export const NOTE_KIND_ICONS: Record<NoteKind, string> = {
  thought: 'lightbulb-outline',
  todo: 'checkbox-marked-outline',
  voice: 'microphone',
  media: 'image',
  bookmark: 'link',
  mixed: 'note-text-outline',
  task: 'checkbox-marked-circle-outline',
};

export type NoteKindLabels = {
  kindThought: string;
  kindTodo: string;
  kindVoice: string;
  kindMedia: string;
  kindBookmark: string;
};

export type NoteEmptyHints = {
  voice: string;
  media: string;
  bookmark: string;
  default: string;
};

export type RelativeTimeLabels = {
  justNow: string;
  minutes: string;
  hours: string;
  days: string;
};

export interface NoteListDisplay {
  title: string;
  subtitle: string | null;
  metaLine: string;
  kindLabel: string;
}

function fillTemplate(template: string, value: number): string {
  return template.replace(/\{\{n\}\}/g, String(value));
}

export function noteKindLabel(kind: NoteKind, labels: NoteKindLabels): string {
  switch (kind) {
    case 'thought':
    case 'mixed':
      return labels.kindThought;
    case 'todo':
    case 'task':
      return labels.kindTodo;
    case 'voice':
      return labels.kindVoice;
    case 'media':
      return labels.kindMedia;
    case 'bookmark':
      return labels.kindBookmark;
    default:
      return labels.kindThought;
  }
}

export function formatNoteRelativeTime(
  timestamp: number,
  labels: RelativeTimeLabels,
  now = Date.now(),
): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return labels.justNow;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return fillTemplate(labels.minutes, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fillTemplate(labels.hours, hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return fillTemplate(labels.days, days);
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function extractAttachmentPreviewText(
  note?: Pick<Note, 'attachments'> | null,
): string {
  const attachments = note?.attachments;
  if (!attachments?.length) return '';

  for (const attachment of attachments) {
    const transcript = attachment.transcript?.trim();
    if (transcript) return transcript;
  }

  const named = attachments.find((attachment) => attachment.fileName?.trim());
  if (named?.fileName?.trim()) return named.fileName.trim();

  return '';
}

function emptyHintForKind(kind: NoteKind, hints: NoteEmptyHints): string {
  switch (kind) {
    case 'voice':
      return hints.voice;
    case 'media':
      return hints.media;
    case 'bookmark':
      return hints.bookmark;
    default:
      return hints.default;
  }
}

function buildMetaLine(
  kindLabel: string,
  timeLabel: string,
  primaryTag?: string,
  compact = false,
): string {
  const tagSuffix = primaryTag ? ` · ${primaryTag}` : '';
  if (compact) return `${timeLabel}${tagSuffix}`;
  return `${kindLabel} · ${timeLabel}${tagSuffix}`;
}

/** Rich list-row copy for inbox and note indexes. */
export function resolveNoteListDisplay(
  entry: NoteIndexEntry,
  options: {
    untitled: string;
    cachedNote?: Pick<Note, 'title' | 'markdown' | 'text' | 'attachments'> | null;
    kindLabels: NoteKindLabels;
    emptyHints: NoteEmptyHints;
    timeLabels: RelativeTimeLabels;
    now?: number;
  },
): NoteListDisplay {
  const kindLabel = noteKindLabel(entry.kind, options.kindLabels);
  const timeLabel = formatNoteRelativeTime(
    entry.createdAt,
    options.timeLabels,
    options.now,
  );
  const primaryTag = entry.tags?.[0]?.trim() || undefined;
  const attachmentText = extractAttachmentPreviewText(options.cachedNote);

  const cachedNote = attachmentText && options.cachedNote && !options.cachedNote.markdown?.trim() && !options.cachedNote.text?.trim()
    ? { ...options.cachedNote, text: attachmentText }
    : options.cachedNote;

  const preview = resolveNoteListPreview(entry, {
    untitled: options.untitled,
    cachedNote,
  });

  const hasContent = preview.title !== options.untitled;

  if (hasContent) {
    return {
      title: preview.title,
      subtitle: preview.subtitle,
      metaLine: buildMetaLine(kindLabel, timeLabel, primaryTag),
      kindLabel,
    };
  }

  return {
    title: kindLabel,
    subtitle: emptyHintForKind(entry.kind, options.emptyHints),
    metaLine: buildMetaLine(kindLabel, timeLabel, primaryTag, true),
    kindLabel,
  };
}
