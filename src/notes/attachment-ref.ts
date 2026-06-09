/** Canonical persisted reference: xopc-attachment://notes/{noteId}/{attachmentId} */
export const NOTE_ATTACHMENT_SCHEME = 'xopc-attachment';

const CANONICAL_REF =
  /^xopc-attachment:\/\/notes\/([^/]+)\/([^/?#]+)$/i;

export type ParsedNoteAttachmentRef = {
  noteId: string;
  attachmentId: string;
};

export function buildNoteAttachmentRef(noteId: string, attachmentId: string): string {
  return `${NOTE_ATTACHMENT_SCHEME}://notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

export function parseNoteAttachmentTarget(
  target: string,
  expectedNoteId?: string,
): ParsedNoteAttachmentRef | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  const canonical = trimmed.split('?')[0].match(CANONICAL_REF);
  if (!canonical) return null;

  const noteId = decodeURIComponent(canonical[1]);
  const attachmentId = decodeURIComponent(canonical[2]);
  if (expectedNoteId && noteId !== expectedNoteId) return null;
  return { noteId, attachmentId };
}

export function attachmentIdFromTarget(target: string, noteId: string): string | undefined {
  return parseNoteAttachmentTarget(target, noteId)?.attachmentId;
}
