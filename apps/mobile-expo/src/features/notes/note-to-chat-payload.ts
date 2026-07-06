import type { ComposerAttachment } from '../chat/composer.types';
import { capAttachments, MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../chat/chat-limits';
import type { NoteAttachment } from '../../query/notes';
import { composerAttachmentFromLocalNoteAttachmentRef } from './notes-local-attachments';

export type NoteEditorAttachment = ComposerAttachment;

export type NoteChatContextLabels = {
  imagePlaceholder: (alt: string) => string;
  voiceTranscript: (text: string) => string;
};

export type NoteChatMediaCollection = {
  attachments: ComposerAttachment[];
  droppedCount: number;
};

type MarkdownImageRef = {
  src: string;
  alt?: string;
};

type MarkdownLinkRef = {
  src: string;
  label?: string;
};

function attachmentDedupeKey(att: ComposerAttachment): string {
  if (att.uri) return `uri:${att.uri}`;
  const rel = att.workspaceRelativePath?.replace(/\\/g, '/').trim();
  if (rel) return `rel:${rel}`;
  const content = att.content.replace(/\s/g, '');
  if (content) return `b64:${content.slice(0, 64)}:${content.length}`;
  if (att.localUri) return `uri:${att.localUri}`;
  return `id:${att.id}`;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isAudioMime(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

function noteAttachmentUri(noteId: string, attachmentId: string): string {
  return `xopc-attachment://notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

function noteAttachmentToComposer(noteId: string, att: NoteAttachment, localUri?: string): ComposerAttachment {
  const isImage = att.type === 'image' || isImageMime(att.mimeType);
  const isAudio = att.type === 'audio' || isAudioMime(att.mimeType);
  return {
    id: att.id,
    type: isImage ? 'image' : 'document',
    name: att.fileName,
    mimeType: att.mimeType,
    size: att.size,
    content: '',
    uri: noteAttachmentUri(noteId, att.id),
    localUri: (isImage || isAudio) ? localUri : undefined,
    durationSeconds: att.duration,
  };
}

function enrichEditorAttachment(
  att: NoteEditorAttachment,
  syncedAttachments?: NoteAttachment[],
): ComposerAttachment {
  const synced = syncedAttachments?.find((item) => item.id === att.id);
  return {
    ...att,
    workspaceRelativePath: att.workspaceRelativePath ?? synced?.relativePath,
    durationSeconds: att.durationSeconds ?? synced?.duration,
  };
}

function collectMarkdownImages(markdown: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(markdown)) != null) {
    refs.push({ alt: match[1]?.trim() || undefined, src: match[2]?.trim() ?? '' });
  }
  return refs;
}

function collectMarkdownAttachmentLinks(markdown: string): MarkdownLinkRef[] {
  const refs: MarkdownLinkRef[] = [];
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(markdown)) != null) {
    if (match.index > 0 && markdown[match.index - 1] === '!') continue;
    const src = match[2]?.trim() ?? '';
    if (!src.startsWith('xopc-local-attachment://') && !src.startsWith('xopc-attachment://')) continue;
    refs.push({ label: match[1]?.trim() || undefined, src });
  }
  return refs;
}

function attachmentIdFromMarkdownSrc(src: string): string | null {
  const xopc = /^xopc-attachment:\/\/notes\/[^/\s)]+\/([^\s)]+)$/.exec(src);
  if (xopc) return decodeURIComponent(xopc[1]);
  return src.trim() || null;
}

/** Markdown-like note body for chat context — never embeds data URIs or file URLs. */
export function buildNoteChatContextText(
  markdown: string,
  labels: NoteChatContextLabels,
  options?: { voiceTranscripts?: string[] },
): string {
  const body = markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt: string) => labels.imagePlaceholder(alt?.trim() || 'image'))
    .trim();

  const transcripts = (options?.voiceTranscripts ?? [])
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => labels.voiceTranscript(text));

  if (!transcripts.length) return body;
  if (!body) return transcripts.join('\n\n');
  return `${body}\n\n${transcripts.join('\n\n')}`;
}

export function extractVoiceTranscripts(syncedAttachments?: NoteAttachment[]): string[] {
  if (!syncedAttachments?.length) return [];
  return syncedAttachments
    .filter((att) => att.type === 'audio' || isAudioMime(att.mimeType))
    .map((att) => att.transcript?.trim() ?? '')
    .filter(Boolean);
}

async function attachmentFromImageRef(
  noteId: string,
  image: MarkdownImageRef,
  syncedAttachments?: NoteAttachment[],
): Promise<ComposerAttachment | null> {
  const localAttachment = composerAttachmentFromLocalNoteAttachmentRef(image.src, image.alt);
  if (localAttachment) return localAttachment;

  const attachmentId = attachmentIdFromMarkdownSrc(image.src);
  if (!attachmentId) return null;
  const synced = syncedAttachments?.find((item) => item.id === attachmentId);
  if (synced) {
    return noteAttachmentToComposer(noteId, synced);
  }
  const name = image.alt?.trim() || 'image';
  return {
    id: attachmentId,
    type: 'image',
    name,
    mimeType: mimeTypeFromName(name),
    size: 0,
    content: '',
  };
}

function attachmentFromLinkRef(
  noteId: string,
  link: MarkdownLinkRef,
  syncedAttachments?: NoteAttachment[],
): ComposerAttachment | null {
  const localAttachment = composerAttachmentFromLocalNoteAttachmentRef(link.src, link.label);
  if (localAttachment) return localAttachment;

  const attachmentId = attachmentIdFromMarkdownSrc(link.src);
  if (!attachmentId) return null;
  const synced = syncedAttachments?.find((item) => item.id === attachmentId);
  return synced ? noteAttachmentToComposer(noteId, synced) : null;
}

function mimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function withinSizeLimit(att: ComposerAttachment): boolean {
  if (att.uri && !att.content) return true;
  if (att.workspaceRelativePath && !att.content) return true;
  if (!att.content) return false;
  const bytes = Math.ceil((att.content.replace(/\s/g, '').length * 3) / 4);
  return bytes <= MAX_WEBCHAT_ATTACHMENT_FILE_BYTES;
}

function pushUnique(
  out: ComposerAttachment[],
  seen: Set<string>,
  att: ComposerAttachment | null | undefined,
): void {
  if (!att) return;
  const key = attachmentDedupeKey(att);
  if (seen.has(key)) return;
  if (!withinSizeLimit(att)) return;
  seen.add(key);
  out.push(att);
}

export async function collectNoteAttachmentsForChat(
  noteId: string,
  markdown: string,
  editorAttachments: NoteEditorAttachment[],
  syncedAttachments?: NoteAttachment[],
): Promise<NoteChatMediaCollection> {
  const raw: ComposerAttachment[] = [];
  const seen = new Set<string>();

  for (const image of collectMarkdownImages(markdown)) {
    pushUnique(raw, seen, await attachmentFromImageRef(noteId, image, syncedAttachments));
  }

  for (const link of collectMarkdownAttachmentLinks(markdown)) {
    pushUnique(raw, seen, attachmentFromLinkRef(noteId, link, syncedAttachments));
  }

  for (const att of editorAttachments) {
    const enriched = enrichEditorAttachment(att, syncedAttachments);
    if (enriched.content) {
      pushUnique(raw, seen, enriched);
      continue;
    }
    if (enriched.workspaceRelativePath || enriched.localUri) {
      pushUnique(raw, seen, enriched);
    }
  }

  if (syncedAttachments?.length) {
    for (const att of syncedAttachments) {
      if (editorAttachments.some((item) => item.id === att.id)) continue;
      pushUnique(raw, seen, noteAttachmentToComposer(noteId, att));
    }
  }

  const capped = capAttachments(raw) ?? [];
  return {
    attachments: capped,
    droppedCount: Math.max(0, raw.length - capped.length),
  };
}
