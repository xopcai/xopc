/** Queued user drafts while a run is active (Cursor-style stack above the input). */

export const MAX_PENDING_FOLLOW_UPS = 10;

export type PendingFollowUpAttachment = {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  /** Session-backed file (inbound/tts) when the queue row has no base64 `data` yet. */
  uri?: string;
  durationSeconds?: number;
};

export type PendingFollowUp = {
  id: string;
  clientMessageId: string;
  text: string;
  attachments?: PendingFollowUpAttachment[];
  /** Thinking level captured when the row was added (used when flushed as a full turn). */
  thinkingLevel?: string;
  version: number;
  delivery: 'next' | 'steer';
  status: 'queued' | 'interrupted';
};

export function projectPendingFollowUps(inputs: readonly unknown[]): PendingFollowUp[] {
  return inputs.flatMap((value): PendingFollowUp[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string'
      || typeof row.clientMessageId !== 'string'
      || typeof row.content !== 'string'
      || typeof row.version !== 'number'
      || (row.effectiveDelivery !== 'next' && row.effectiveDelivery !== 'steer')
      || (row.status !== 'queued' && row.status !== 'interrupted')
    ) return [];
    return [{
      id: row.id,
      clientMessageId: row.clientMessageId,
      text: row.content,
      attachments: Array.isArray(row.attachments)
        ? row.attachments as PendingFollowUp['attachments']
        : undefined,
      thinkingLevel: typeof row.thinking === 'string' ? row.thinking : undefined,
      version: row.version,
      delivery: row.effectiveDelivery,
      status: row.status,
    }];
  });
}
