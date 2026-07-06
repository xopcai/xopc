/** Keep in sync with `xopc/src/gateway/chat-limits.ts` and web `MAX_CHAT_ATTACHMENTS`. */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Max raw bytes per attachment in mobile web chat JSON (base64 in `data`). */
export const MAX_WEBCHAT_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;

export function capAttachments<T>(attachments: T[] | undefined): T[] | undefined {
  if (!attachments?.length) return attachments;
  if (attachments.length <= MAX_CHAT_ATTACHMENTS) return attachments;
  return attachments.slice(0, MAX_CHAT_ATTACHMENTS);
}
