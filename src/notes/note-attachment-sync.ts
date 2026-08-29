import type { Note, NoteAttachment } from './types.js';
import { parseNoteMarkdown } from './note-markdown.js';

export function collectReferencedAttachmentIds(note: Pick<Note, 'id' | 'markdown'>): Set<string> {
  return new Set(parseNoteMarkdown(note.markdown, note.id).attachments.map((item) => item.attachmentId));
}

export function partitionAttachmentsByReference(
  note: Pick<Note, 'id' | 'markdown' | 'attachments'>,
): { kept: NoteAttachment[]; removed: NoteAttachment[] } {
  const referenced = collectReferencedAttachmentIds(note);
  const attachments = note.attachments ?? [];
  const kept: NoteAttachment[] = [];
  const removed: NoteAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.retainWithoutReference || referenced.has(attachment.id)) kept.push(attachment);
    else removed.push(attachment);
  }

  return { kept, removed };
}
