import type { Note, NoteAttachment, NoteIndexEntry } from '../../query/notes';

function attachmentPreviewText(
  attachments?: Pick<NoteAttachment, 'transcript' | 'fileName'>[],
): string {
  if (!attachments?.length) return '';
  for (const attachment of attachments) {
    const transcript = attachment.transcript?.trim();
    if (transcript) return transcript;
  }
  const named = attachments.find((attachment) => attachment.fileName?.trim());
  return named?.fileName?.trim() ?? '';
}

const DEFAULT_LIST_TITLE_MAX = 48;
const DEFAULT_LIST_SNIPPET_MAX = 160;

function truncateText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const chars = Array.from(normalized);
  if (chars.length <= maxLen) return normalized;
  return `${chars.slice(0, maxLen).join('')}…`;
}

function markdownToPlainText(markdown: string | undefined): string {
  return (markdown ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolvePlainTextFromEntry(
  entry: Pick<NoteIndexEntry, 'snippet'>,
  cachedNote?: Pick<Note, 'markdown' | 'text' | 'attachments'> | null,
): string {
  const snippet = entry.snippet?.trim();
  if (snippet) return snippet;

  if (cachedNote) {
    const markdown = markdownToPlainText(cachedNote.markdown);
    if (markdown) return markdown;
    const fromAttachments = attachmentPreviewText(cachedNote.attachments);
    if (fromAttachments) return fromAttachments;
    const text = cachedNote.text?.trim();
    if (text) return text;
  }

  return '';
}

export function deriveNoteTitle(
  markdown: string | undefined,
  maxLen = 10,
  fallback = 'Untitled',
  attachments?: Pick<NoteAttachment, 'transcript' | 'fileName'>[],
): string {
  const plain = markdownToPlainText(markdown);
  const source = plain || attachmentPreviewText(attachments).replace(/\s+/g, ' ').trim();
  if (!source) return fallback;
  return Array.from(source).slice(0, maxLen).join('');
}

export function resolveDisplayTitle(
  note: Pick<Note, 'title' | 'markdown' | 'text' | 'attachments'> | undefined,
  fallback: string,
  maxLen = 10,
): string {
  const explicitTitle = note?.title?.trim();
  if (explicitTitle) return explicitTitle;
  if (!note) return fallback;
  return deriveNoteTitle(note.markdown ?? note.text, maxLen, fallback, note.attachments);
}

export function resolveNoteListTitle(
  entry: Pick<NoteIndexEntry, 'title' | 'snippet'>,
  fallback: string,
  cachedNote?: Pick<Note, 'title' | 'markdown' | 'text' | 'attachments'> | null,
  maxLen = 10,
): string {
  const explicitTitle = entry.title?.trim();
  if (explicitTitle) return explicitTitle;

  if (cachedNote) {
    const cachedTitle = cachedNote.title?.trim();
    if (cachedTitle) return cachedTitle;
    const derived = deriveNoteTitle(cachedNote.markdown ?? cachedNote.text, maxLen, '', cachedNote.attachments);
    if (derived) return derived;
  }

  const plain = resolvePlainTextFromEntry(entry, cachedNote);
  if (plain) return truncateText(plain, maxLen);

  return fallback;
}

export function resolveNoteListSnippet(
  entry: Pick<NoteIndexEntry, 'snippet'>,
  cachedNote?: Pick<Note, 'markdown' | 'text' | 'attachments'> | null,
  maxLen = DEFAULT_LIST_SNIPPET_MAX,
): string {
  return truncateText(resolvePlainTextFromEntry(entry, cachedNote), maxLen);
}

export interface NoteListPreview {
  title: string;
  subtitle: string | null;
}

export function resolveNoteListPreview(
  entry: Pick<NoteIndexEntry, 'title' | 'snippet'>,
  options: {
    untitled: string;
    cachedNote?: Pick<Note, 'title' | 'markdown' | 'text' | 'attachments'> | null;
    titleMaxLen?: number;
    snippetMaxLen?: number;
  },
): NoteListPreview {
  const titleMaxLen = options.titleMaxLen ?? DEFAULT_LIST_TITLE_MAX;
  const snippetMaxLen = options.snippetMaxLen ?? DEFAULT_LIST_SNIPPET_MAX;
  const cached = options.cachedNote;

  const explicitTitle = entry.title?.trim() || cached?.title?.trim() || '';
  const plain = resolvePlainTextFromEntry(entry, cached);

  if (explicitTitle) {
    const subtitle = plain && plain !== explicitTitle
      ? truncateText(plain, snippetMaxLen)
      : null;
    return { title: explicitTitle, subtitle };
  }

  if (plain) {
    return {
      title: truncateText(plain, titleMaxLen),
      subtitle: null,
    };
  }

  return { title: options.untitled, subtitle: null };
}

export function normalizeNoteIndexEntry(
  raw: NoteIndexEntry & { text?: string },
): NoteIndexEntry {
  if (raw.snippet?.trim()) return raw;
  const plain = raw.text?.trim() ?? '';
  if (!plain) return raw;
  const entry = { ...raw };
  delete entry.text;
  return { ...entry, snippet: plain.slice(0, 200) };
}

export function countNoteCharacters(markdown: string | undefined): number {
  return Array.from(markdownToPlainText(markdown)).length;
}
