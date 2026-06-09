import type { Note, NoteAttachment } from './types.js';
import { attachmentIdFromTarget } from './attachment-ref.js';
import { notePlainText } from './note-index-meta.js';

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_LINK = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
const BARE_ATTACHMENT_REF = /xopc-attachment:\/\/notes\/([^/]+)\/([^/?#"'\s)]+)/gi;

/** Attachment ids referenced in note markdown, blocks, or plain text. */
export function collectReferencedAttachmentIds(
  note: Pick<Note, 'id' | 'text' | 'blocks'>,
): Set<string> {
  const ids = new Set<string>();

  for (const block of note.blocks ?? []) {
    if (block.type === 'image') ids.add(block.attachmentId);
  }

  const source = notePlainText(note);
  if (!source.trim()) return ids;

  for (const match of source.matchAll(MARKDOWN_IMAGE)) {
    const target = match[2];
    if (typeof target !== 'string') continue;
    const attachmentId = attachmentIdFromTarget(target, note.id);
    if (attachmentId) ids.add(attachmentId);
  }

  for (const match of source.matchAll(MARKDOWN_LINK)) {
    const target = match[2];
    if (typeof target !== 'string') continue;
    const attachmentId = attachmentIdFromTarget(target, note.id);
    if (attachmentId) ids.add(attachmentId);
  }

  for (const match of source.matchAll(BARE_ATTACHMENT_REF)) {
    const noteId = decodeURIComponent(match[1]);
    if (noteId !== note.id) continue;
    ids.add(decodeURIComponent(match[2]));
  }

  return ids;
}

export function partitionAttachmentsByReference(
  note: Pick<Note, 'id' | 'text' | 'blocks' | 'attachments'>,
): { kept: NoteAttachment[]; removed: NoteAttachment[] } {
  const referenced = collectReferencedAttachmentIds(note);
  const attachments = note.attachments ?? [];
  const kept: NoteAttachment[] = [];
  const removed: NoteAttachment[] = [];

  for (const attachment of attachments) {
    if (referenced.has(attachment.id)) {
      kept.push(attachment);
    } else {
      removed.push(attachment);
    }
  }

  return { kept, removed };
}
