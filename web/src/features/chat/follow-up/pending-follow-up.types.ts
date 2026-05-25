/** Queued user drafts while a run is active (Cursor-style stack above the input). */

export const MAX_PENDING_FOLLOW_UPS = 10;

/** Idle after a turn ends before auto-sending the next queued follow-up (keep in sync with streaming hook). */
export const FOLLOW_UP_AUTO_SEND_IDLE_MS = 72;

export type PendingFollowUpAttachment = {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  /** Session-backed file (inbound/tts) when the queue row has no base64 `data` yet. */
  workspaceRelativePath?: string;
  durationSeconds?: number;
};

export type PendingFollowUp = {
  id: string;
  text: string;
  attachments?: PendingFollowUpAttachment[];
  /** Thinking level captured when the row was added (used when flushed as a full turn). */
  thinkingLevel?: string;
};
