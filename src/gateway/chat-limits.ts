/** Web chat: max files per user message (keep in sync with `web` MAX_CHAT_ATTACHMENTS). */
export const MAX_CHAT_ATTACHMENTS = 10;

/**
 * Max raw bytes per attachment in web chat (keep in sync with `web` MAX_WEBCHAT_ATTACHMENT_FILE_BYTES).
 * JSON requests send base64 (`data`); gateway body limit must allow worst-case payload.
 */
export const MAX_WEBCHAT_ATTACHMENT_FILE_BYTES = 32 * 1024 * 1024;

/** Upper bound for `POST /api/agent` JSON body when every slot is a max-sized binary attachment (base64 ~4/3). */
export function maxWebchatAgentRequestBodyBytes(): number {
  const rawMax = MAX_WEBCHAT_ATTACHMENT_FILE_BYTES * MAX_CHAT_ATTACHMENTS;
  return Math.ceil((rawMax * 4) / 3) + 1024 * 1024;
}
