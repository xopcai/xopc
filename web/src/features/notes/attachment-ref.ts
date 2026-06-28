/** Canonical persisted reference: xopc-attachment://notes/{noteId}/{attachmentId} */
export const NOTE_ATTACHMENT_SCHEME = 'xopc-attachment';

const CANONICAL_REF =
  /^xopc-attachment:\/\/notes\/([^/]+)\/([^/?#]+)$/i;
const API_PATH_REF =
  /^\/api\/notes\/([^/]+)\/media\/([^/?#]+)$/i;

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

  const targetWithoutQuery = trimmed.split('?')[0];
  const canonical = targetWithoutQuery.match(CANONICAL_REF);
  const apiPath = targetWithoutQuery.match(API_PATH_REF);
  const match = canonical ?? apiPath;
  if (!match) return null;

  const noteId = decodeURIComponent(match[1]);
  const attachmentId = decodeURIComponent(match[2]);
  if (expectedNoteId && noteId !== expectedNoteId) return null;
  return { noteId, attachmentId };
}

/** HTTP path for authenticated blob fetch (never persisted in markdown). */
export function noteMediaApiPath(noteId: string, attachmentId: string): string {
  return `/api/notes/${encodeURIComponent(noteId)}/media/${encodeURIComponent(attachmentId)}`;
}

export function isNoteAttachmentTarget(target: string): boolean {
  return parseNoteAttachmentTarget(target) !== null;
}
