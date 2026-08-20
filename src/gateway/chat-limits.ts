/** Web chat: max files per user message (keep in sync with `web` MAX_CHAT_ATTACHMENTS). */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Inline chat text stays bounded; larger content belongs in an attachment. */
export const MAX_CHAT_INLINE_TEXT_BYTES = 256 * 1024;

/**
 * Max raw bytes per attachment in web chat (keep in sync with `web` MAX_WEBCHAT_ATTACHMENT_FILE_BYTES).
 * JSON requests send base64 (`data`); gateway body limit must allow worst-case payload.
 */
export const MAX_WEBCHAT_ATTACHMENT_FILE_BYTES = 32 * 1024 * 1024;

export function validateWebchatAttachments(attachments: unknown[] | undefined): string | null {
  if (!attachments) return null;
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return `Too many attachments (maximum ${MAX_CHAT_ATTACHMENTS})`;
  }
  const maxBase64Length = 4 * Math.ceil(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES / 3);
  if (attachments.some((item) => item && typeof item === 'object'
    && typeof (item as { data?: unknown }).data === 'string'
    && (item as { data: string }).data.length > maxBase64Length)) {
    return `Attachment exceeds maximum size (${MAX_WEBCHAT_ATTACHMENT_FILE_BYTES} bytes)`;
  }
  return null;
}

export function validateWebchatContent(content: unknown): string | null {
  if (typeof content !== 'string') return 'Message content must be a string';
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_CHAT_INLINE_TEXT_BYTES) {
    return `Message content exceeds maximum size (${MAX_CHAT_INLINE_TEXT_BYTES} bytes)`;
  }
  return null;
}

/** Upper bound for a session input request when every attachment is encoded as base64. */
export function maxSessionInputRequestBodyBytes(): number {
  const rawMax = MAX_WEBCHAT_ATTACHMENT_FILE_BYTES * MAX_CHAT_ATTACHMENTS;
  return Math.ceil((rawMax * 4) / 3) + 1024 * 1024;
}
